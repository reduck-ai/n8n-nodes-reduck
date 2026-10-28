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

import { getDevices, getScriptArgs, searchScripts } from './methods';
import { parseScriptAddress, reduckRequest, type Run } from './transport';

const POLL_MS = 2000;
// What a start waits on the server before it answers. A longer run is then read again here.
const SERVER_WAIT_SECONDS = 45;

export class Reduck implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Reduck',
		name: 'reduck',
		icon: { light: 'file:reduck.svg', dark: 'file:reduck.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Run Reduck browser scripts on any website',
		defaults: { name: 'Reduck' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'reduckApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Script', value: 'script' },
					{ name: 'Run', value: 'run' },
				],
				default: 'script',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['script'] } },
				options: [
					{
						name: 'Run',
						value: 'run',
						description: 'Run a script and get its result',
						action: 'Run a script',
					},
				],
				default: 'run',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['run'] } },
				options: [
					{
						name: 'Get',
						value: 'get',
						description: 'Get a run and its result',
						action: 'Get a run',
					},
				],
				default: 'get',
			},
			{
				displayName: 'Script',
				name: 'script',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				description: 'The script to run',
				displayOptions: { show: { resource: ['script'], operation: ['run'] } },
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
						placeholder: 'e.g. reduck/example.com/noop',
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
				displayOptions: {
					show: { resource: ['script'], operation: ['run'] },
					hide: { script: [''] },
				},
			},
			{
				displayName: 'Browser Name or ID',
				name: 'deviceId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getDevices' },
				default: '',
				description:
					'Where the script runs: a Reduck managed browser, or one of your paired browsers. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: { show: { resource: ['script'], operation: ['run'] } },
			},
			{
				displayName: 'Wait for Result',
				name: 'waitForResult',
				type: 'boolean',
				default: true,
				description:
					'Whether to wait until the run finishes. Turn it off to get the run right away and read it later with Run > Get.',
				displayOptions: { show: { resource: ['script'], operation: ['run'] } },
			},
			{
				displayName: 'Timeout (Seconds)',
				name: 'timeout',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 600,
				description: 'How long to wait for the run before the node fails',
				displayOptions: {
					show: { resource: ['script'], operation: ['run'], waitForResult: [true] },
				},
			},
			{
				displayName: 'Run ID',
				name: 'runId',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'e.g. 15783c22-bb29-43a6-956f-7ea3d3852c25',
				displayOptions: { show: { resource: ['run'], operation: ['get'] } },
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
				const resource = this.getNodeParameter('resource', i) as string;
				const run =
					resource === 'run'
						? await getRun(this, this.getNodeParameter('runId', i) as string)
						: await runScript(this, i);
				if (run.result && 'error' in run.result) {
					throw new NodeOperationError(this.getNode(), run.result.error, {
						itemIndex: i,
						description: `Run ${run.id}`,
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

async function runScript(ctx: IExecuteFunctions, i: number): Promise<Run> {
	const address = ctx.getNodeParameter('script', i, '', { extractValue: true }) as string;
	const script = parseScriptAddress(address);
	if (!script) {
		throw new NodeOperationError(ctx.getNode(), `"${address}" is not a script address (handle/host/slug)`, {
			itemIndex: i,
		});
	}
	const args = (ctx.getNodeParameter('args', i, {}) as { value?: IDataObject | null }).value ?? {};
	const deviceId = ctx.getNodeParameter('deviceId', i, '') as string;
	const waitForResult = ctx.getNodeParameter('waitForResult', i, true) as boolean;

	const scriptPath = [script.handle, script.host, script.slug].map(encodeURIComponent).join('/');
	let run = await reduckRequest<Run>(ctx, 'POST', `/api/scripts/${scriptPath}/runs`, {
		body: {
			args,
			...(deviceId ? { device_id: deviceId } : {}),
			wait_seconds: waitForResult ? SERVER_WAIT_SECONDS : 0,
		},
	});
	if (!waitForResult) return run;

	const deadline = Date.now() + (ctx.getNodeParameter('timeout', i, 600) as number) * 1000;
	while (run.finished_at === null) {
		if (Date.now() > deadline) {
			throw new NodeOperationError(ctx.getNode(), `The run did not finish in time. Run ID: ${run.id}`, {
				itemIndex: i,
				description: 'Read it later with Run > Get, or raise the timeout.',
			});
		}
		await sleep(POLL_MS);
		run = await getRun(ctx, run.id);
	}
	return run;
}

const getRun = (ctx: IExecuteFunctions, runId: string) =>
	reduckRequest<Run>(ctx, 'GET', `/api/runs/${encodeURIComponent(runId)}`);

// The run, with the script's output as `result` (the API wraps it as { result }).
const toItem = (run: Run): IDataObject => ({
	...run,
	result: run.result && 'result' in run.result ? (run.result.result as IDataObject) : null,
});
