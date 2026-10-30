import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	sleep,
	type IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
} from 'n8n-workflow';

import { FILE_FIELD, getDevices, getScriptArgs, searchScripts } from './methods';
import { parseScriptAddress, reduckRequest, reduckUrl, type Run } from './transport';

const POLL_MS = 2000;

const AUTHENTICATIONS = [
	{ name: 'OAuth2', value: 'oAuth2' },
	{ name: 'API Key', value: 'apiKey' },
];

export class Reduck implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Reduck',
		name: 'reduck',
		icon: { light: 'file:reduck.svg', dark: 'file:reduck.dark.svg' },
		group: ['transform'],
		version: [1, 1.1],
		subtitle: '={{$parameter["script"].value}}',
		description: 'Run Reduck browser scripts on any website',
		defaults: { name: 'Reduck' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'reduckApi',
				required: true,
				displayOptions: { show: { authentication: ['apiKey'] } },
			},
			{
				name: 'reduckOAuth2Api',
				required: true,
				displayOptions: { show: { authentication: ['oAuth2'] } },
			},
		],
		properties: [
			// n8n saves no parameter that equals its default, so a node saved with the default holds no
			// value here and reads whatever the default is now. Version 1 keeps API Key for those
			// nodes; a node added from 1.1 on starts with OAuth2.
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				options: AUTHENTICATIONS,
				default: 'apiKey',
				displayOptions: { show: { '@version': [1] } },
			},
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				options: AUTHENTICATIONS,
				default: 'oAuth2',
				displayOptions: { show: { '@version': [{ _cnd: { gte: 1.1 } }] } },
			},
			{
				displayName: 'Script',
				name: 'script',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				description: 'The script to run',
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						placeholder: 'Select a script...',
						typeOptions: { searchListMethod: 'searchScripts', searchable: true },
					},
					{
						displayName: 'By Address',
						name: 'address',
						type: 'string',
						placeholder: 'e.g. reduck/news.ycombinator.com/top_stories',
						hint: 'The owner handle, the site and the script, separated by slashes',
						validation: [
							{
								type: 'regex',
								properties: {
									regex: '^[^/\\s]+/[^/\\s]+/[^/\\s]+$',
									errorMessage: 'Use the form handle/host/slug',
								},
							},
						],
					},
				],
			},
			{
				displayName: 'Arguments',
				name: 'args',
				type: 'resourceMapper',
				noDataExpression: true,
				default: { mappingMode: 'defineBelow', value: null },
				required: true,
				typeOptions: {
					loadOptionsDependsOn: ['script.value'],
					resourceMapper: {
						resourceMapperMethod: 'getScriptArgs',
						mode: 'add',
						fieldWords: { singular: 'argument', plural: 'arguments' },
						addAllFields: true,
						supportAutoMap: false,
						allowEmptyValues: true,
						noFieldsError: 'This script takes no arguments',
					},
				},
				displayOptions: { hide: { script: [''] } },
			},
			{
				displayName: 'Browser Name or ID',
				name: 'deviceId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getDevices' },
				default: '',
				description:
					'Where the script runs: a Reduck managed browser, or one of your paired browsers. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			// The managed browser's own options. The API refuses them on a paired browser, so they show
			// only while the managed browser is chosen. The regions are the API's (MANAGED_REGIONS in the
			// MCP's browser.ts); it refuses any other and names the ones it has.
			{
				displayName: 'Region',
				name: 'region',
				type: 'options',
				options: [
					{ name: 'Asia Pacific (Singapore)', value: 'ap-southeast-1' },
					{ name: 'Europe (Frankfurt)', value: 'eu-central-1' },
					{ name: 'US East', value: 'us-east-1' },
					{ name: 'US West', value: 'us-west-2' },
				],
				default: 'eu-central-1',
				description:
					'The datacenter of the managed browser: Europe (Frankfurt) by default. Choose the one nearest to the site.',
				displayOptions: { show: { deviceId: [''] } },
			},
			{
				displayName: 'Country',
				name: 'country',
				type: 'string',
				default: '',
				placeholder: 'e.g. FR',
				description:
					'The ISO 3166 alpha-2 code of the country the managed browser connects to the site from, through a residential proxy. Use it for a site that changes by country. Leave it empty to connect from the datacenter.',
				displayOptions: { show: { deviceId: [''] } },
			},
		],
	};

	methods = {
		listSearch: { searchScripts },
		resourceMapping: { getScriptArgs },
		loadOptions: { getDevices },
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const run = await runScript(this, i);
				if (run.result && 'error' in run.result) {
					throw new NodeOperationError(this.getNode(), run.result.error, {
						itemIndex: i,
						description: `The run's steps and screenshots: ${await reduckUrl(this)}/runs/${run.id}`,
					});
				}
				out.push({ json: toItem(run), pairedItem: { item: i } });
			} catch (error) {
				// This node's own errors already carry their message; anything else came from the API.
				const failure =
					error instanceof NodeOperationError || error instanceof NodeApiError
						? error
						: new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
				if (!this.continueOnFail()) throw failure;
				out.push({ json: { error: failure.message }, pairedItem: { item: i } });
			}
		}
		return [out];
	}
}

// Starts the run and reads it again until it ends. n8n's own workflow timeout bounds the wait.
// The run request holds for the API's default wait: reduck.ai closes a request held 60 s without
// an answer, which the API's longest wait passes.
async function runScript(ctx: IExecuteFunctions, i: number): Promise<Run> {
	const address = ctx.getNodeParameter('script', i, '', { extractValue: true }) as string;
	const script = parseScriptAddress(address);
	if (!script) {
		throw new NodeOperationError(ctx.getNode(), `"${address}" is not a script address (handle/host/slug)`, {
			itemIndex: i,
		});
	}
	// The form sends every field, a blank one as null. A blank field is one the caller did not give:
	// left out, the script's schema fills in its default or refuses a required argument by name,
	// where null would be coerced to 0 or "" and pass.
	const form = (ctx.getNodeParameter('args', i, {}) as { value?: IDataObject | null }).value ?? {};
	const args: IDataObject = {};
	const files: IDataObject = {};
	for (const [key, value] of Object.entries(form)) {
		if (value === null || value === undefined || value === '') continue;
		if (!key.startsWith(FILE_FIELD)) {
			args[key] = value;
			continue;
		}
		const property = String(value);
		const { mimeType } = ctx.helpers.assertBinaryData(i, property);
		const bytes = await ctx.helpers.getBinaryDataBuffer(i, property);
		files[key.slice(FILE_FIELD.length)] = { b64: bytes.toString('base64'), mime: mimeType };
	}
	const deviceId = ctx.getNodeParameter('deviceId', i, '') as string;
	const region = ctx.getNodeParameter('region', i, '') as string;
	const country = (ctx.getNodeParameter('country', i, '') as string).trim();

	const scriptPath = [script.handle, script.host, script.slug].map(encodeURIComponent).join('/');
	let run = await reduckRequest<Run>(ctx, 'POST', `/api/scripts/${scriptPath}/runs`, {
		body: {
			args,
			...(Object.keys(files).length ? { files } : {}),
			// A paired browser, or the managed one with its options: never a mix the API refuses.
			...(deviceId
				? { device_id: deviceId }
				: { ...(region ? { region } : {}), ...(country ? { country } : {}) }),
		},
	});
	while (run.finished_at === null) {
		await sleep(POLL_MS);
		run = await reduckRequest<Run>(ctx, 'GET', `/api/runs/${encodeURIComponent(run.id)}`);
	}
	return run;
}

// The run, with the script's output as `result` (the API wraps it as { result }).
const toItem = (run: Run): IDataObject => ({
	...run,
	result: run.result && 'result' in run.result ? (run.result.result as IDataObject) : null,
});
