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

import { FILE_FIELD, PAIRED_BROWSER, getDevices, getHandles, getScriptArgs, searchScripts, type Script } from './methods';
import { REVIEW_PROPERTIES, prepare, review } from './review';
import { parseScriptAddress, reduckRequest, reduckUrl, scriptPath, type Run } from './transport';

// Reduck allows an account 60 API requests a minute, and each run on a paired browser spends one
// to wake it: a read every 10 s leaves the rest to a batch of 10 such runs.
const POLL_MS = 10_000;
// Above the longest a run takes on Reduck: 16 minutes queued, then 15 held (the MCP's
// admission.ts). A run still open after it is one Reduck lost.
const MAX_WAIT_MINUTES = 32;
// The managed browser's budget, and 10 runs of 3 minutes on a 2-slot device still start inside the
// queue's 16-minute wait.
const BATCH = 10;
// Decisions in flight at once: the width flock's own eval runs at, under the model's rate limit.
const REVIEWS_AT_ONCE = 8;
// A site refuses about 1 managed run in 3 at random (Reddit's captcha): 3 more tries miss 1 in 81.
const RETRIES = 3;

// One input item's run: its place in the output, its script, where it runs, and whether its script
// only reads, so a failed run can run again.
interface ItemRun {
	i: number;
	script: IDataObject;
	target: IDataObject;
	readOnly: boolean;
}

export class Reduck implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Reduck',
		name: 'reduck',
		icon: { light: 'file:reduck.svg', dark: 'file:reduck.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["resource"] === "review" ? $parameter["prompt"] : $parameter["script"].value}}',
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
					{ name: 'Review', value: 'review' },
				],
				default: 'script',
			},
			// It names the action that the nodes panel and an AI agent show.
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
						action: 'Run script',
						description: 'Run a browser script on a website',
					},
				],
				default: 'run',
			},
			{
				displayName: 'Handle Name or ID',
				name: 'handle',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getHandles' },
				default: '',
				displayOptions: { show: { resource: ['script'] } },
				description:
					'The owner of the script. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Script',
				name: 'script',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				description: 'The script to run',
				displayOptions: { show: { resource: ['script'] } },
				// n8n empties the field when the handle changes.
				typeOptions: { loadOptionsDependsOn: ['handle'] },
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
						placeholder: 'e.g. google.com/get_ai_overview',
						validation: [
							{
								type: 'regex',
								properties: {
									regex: '^([^/\\s]+/)?[^/\\s]+/[^/\\s]+$',
									errorMessage: 'Use the form host/slug or handle/host/slug',
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
					loadOptionsDependsOn: ['handle', 'script.value'],
					resourceMapper: {
						resourceMapperMethod: 'getScriptArgs',
						mode: 'add',
						fieldWords: { singular: 'argument', plural: 'arguments' },
						addAllFields: true,
						supportAutoMap: false,
						allowEmptyValues: true,
						noFieldsError: 'This script takes no arguments',
						// A script's arguments change as it is improved: a saved node takes the new ones when
						// it is opened, with its values kept, as Refresh would do.
						refreshStaleSchemaOnOpen: true,
					},
				},
				displayOptions: { show: { resource: ['script'] }, hide: { script: [''] } },
			},
			// The browser comes first, as the API's `browser`, then what fits it: the device, or the
			// managed browser's options.
			{
				displayName: 'Browser',
				name: 'browser',
				type: 'options',
				options: [
					{
						name: 'Paired Browser',
						value: PAIRED_BROWSER,
						description: 'Your Chrome with the Reduck extension. Chrome must be open.',
					},
					{
						name: 'Managed Browser',
						value: 'managed',
						description: 'A browser that Reduck hosts. It runs without your computer.',
					},
				],
				default: PAIRED_BROWSER,
				description: 'Where the script runs',
				displayOptions: { show: { resource: ['script'] } },
			},
			{
				displayName: 'Device Name or ID',
				name: 'deviceId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getDevices' },
				default: PAIRED_BROWSER,
				description:
					'The paired device to run on. Choose one by name when you have more than one. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: { show: { resource: ['script'], browser: [PAIRED_BROWSER] } },
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				// The API refuses Region and Country on a paired browser. The regions are the API's
				// (MANAGED_REGIONS in the MCP's browser.ts): it refuses any other and names the ones it has.
				options: [
					{
						displayName: 'Region',
						name: 'region',
						type: 'options',
						displayOptions: { show: { '/browser': ['managed'] } },
						options: [
							{ name: 'Asia Pacific (Singapore)', value: 'ap-southeast-1' },
							{ name: 'Europe (Frankfurt)', value: 'eu-central-1' },
							{ name: 'US East', value: 'us-east-1' },
							{ name: 'US West', value: 'us-west-2' },
						],
						default: 'eu-central-1',
						description:
							'The datacenter of the managed browser: Europe (Frankfurt) by default. Choose the one nearest to the site.',
					},
					{
						displayName: 'Country',
						name: 'country',
						type: 'string',
						displayOptions: { show: { '/browser': ['managed'] } },
						default: '',
						placeholder: 'e.g. FR',
						description:
							'The ISO 3166 alpha-2 code of the country the managed browser connects to the site from, through a residential proxy. Use it for a site that changes by country. Leave it empty to connect from the datacenter.',
					},
					{
						displayName: 'Retries',
						name: 'retries',
						type: 'number',
						typeOptions: { minValue: 0, maxValue: 5 },
						default: RETRIES,
						description:
							'How many more times a failed run starts again, on a new browser. Only for a script that only reads: a script that writes never runs again.',
					},
				],
				displayOptions: { show: { resource: ['script'] } },
			},
			{
				displayName: 'Simplify',
				name: 'simplify',
				type: 'boolean',
				default: true,
				description: 'Whether to return a simplified version of the response instead of the raw data',
				displayOptions: { show: { resource: ['script'] } },
			},
			...REVIEW_PROPERTIES,
		],
	};

	methods = {
		listSearch: { searchScripts },
		resourceMapping: { getScriptArgs },
		loadOptions: { getDevices, getHandles },
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out = new Array<INodeExecutionData>(items.length);

		const fail = (error: unknown, i: number) => {
			// This node's own errors already carry their message; anything else came from the API.
			const failure =
				error instanceof NodeOperationError || error instanceof NodeApiError
					? error
					: new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
			if (!this.continueOnFail()) throw failure;
			// n8n's own shape for a failed item: { error, details } and nothing else is what sends it
			// down the error output ("Continue (using error output)"). Not `item.error`: n8n then
			// rewrites json to the message alone and the run's link in `details` is lost.
			out[i] = {
				json: { error: failure.message, ...(failure.description ? { details: failure.description } : {}) },
				pairedItem: { item: i },
			};
		};

		if (this.getNodeParameter('resource', 0, 'script') === 'review') {
			const app = prepare(this);
			let next = 0;
			await Promise.all(
				Array.from({ length: Math.min(REVIEWS_AT_ONCE, items.length) }, async () => {
					for (let i = next++; i < items.length; i = next++) {
						try {
							out[i] = { json: await review(this, await app, i), pairedItem: { item: i } };
						} catch (error) {
							fail(error, i);
						}
					}
				}),
			);
			return [out];
		}

		// One request has one browser target, and stays under the API's 4.5 MB: a file goes alone.
		const groups = new Map<string, ItemRun[]>();
		const versions = new Map<string, Promise<Script['current_version']>>();
		for (let i = 0; i < items.length; i++) {
			try {
				const item = await itemRunOf(this, i, versions);
				const key = item.script.files ? `item ${i}` : JSON.stringify(item.target);
				groups.set(key, [...(groups.get(key) ?? []), item]);
			} catch (error) {
				fail(error, i);
			}
		}

		for (const group of groups.values()) {
			for (let at = 0; at < group.length; at += BATCH) {
				const slice = group.slice(at, at + BATCH);
				let runs: Run[] = [];
				try {
					runs = await runBatch(this, slice);
					// A failed run of a script that only reads starts again: the site often refused that
					// browser (a captcha, a block), and a new one comes from another address.
					const { retries = RETRIES } = this.getNodeParameter('options', slice[0].i, {}) as { retries?: number };
					for (let left = retries; left > 0; left--) {
						const again = slice.filter((item, j) => item.readOnly && 'error' in (runs[j].result ?? {}));
						if (!again.length) break;
						const retried = await runBatch(this, again);
						again.forEach((item, k) => (runs[slice.indexOf(item)] = retried[k]));
					}
				} catch (error) {
					slice.forEach(({ i }) => fail(error, i));
				}
				for (const [j, run] of runs.entries()) {
					const { i } = slice[j];
					try {
						const runUrl = `${await reduckUrl(this)}/runs/${run.id}`;
						if (run.result && 'error' in run.result) {
							// The message says what happened; the description, what to do about it.
							throw new NodeOperationError(this.getNode(), run.result.error, {
								itemIndex: i,
								description: [run.external_message, `The run's steps and screenshots: ${runUrl}`]
									.filter(Boolean)
									.join('\n'),
							});
						}
						const simplify = this.getNodeParameter('simplify', i, false) as boolean;
						out[i] = { json: simplify ? simplifyRun(run, runUrl) : toItem(run), pairedItem: { item: i } };
					} catch (error) {
						fail(error, i);
					}
				}
			}
		}
		return [out];
	}
}

// Starts the runs and reads them again until they end, or until MAX_WAIT_MINUTES. The run request
// holds for the API's default wait, under the 60 s after which VPNs and proxies drop a connection
// that carries no byte.
async function runBatch(ctx: IExecuteFunctions, items: ItemRun[]): Promise<Run[]> {
	let batch: { batch_id: string; runs: Run[] };
	try {
		batch = await reduckRequest<{ batch_id: string; runs: Run[] }>(ctx, 'POST', '/api/runs', {
			body: { scripts: items.map((item) => item.script), ...items[0].target },
		});
	} catch (error) {
		// Default with several paired browsers: the API refuses (409), as the choice is ambiguous,
		// and names them. Not an API failure but a setting to change: its sentence as is, and where.
		// The sentence is checked too, as the API also answers 409 for other refusals (an archived
		// script).
		const apiError = error instanceof NodeApiError ? error : new NodeApiError(ctx.getNode(), error as JsonObject);
		if (
			'browser' in items[0].target &&
			apiError.httpCode === '409' &&
			apiError.message.startsWith('Multiple ')
		) {
			throw new NodeOperationError(ctx.getNode(), apiError.message, {
				description: 'Choose your browser by name in Device.',
			});
		}
		throw apiError;
	}
	let { runs } = batch;
	const deadline = Date.now() + MAX_WAIT_MINUTES * 60_000;
	while (runs.some((run) => run.finished_at === null)) {
		if (Date.now() > deadline) {
			throw new NodeOperationError(ctx.getNode(), `The runs did not end in ${MAX_WAIT_MINUTES} minutes`, {
				description: `Their state on Reduck: ${await reduckUrl(ctx)}/runs`,
			});
		}
		await sleep(POLL_MS);
		({ data: runs } = await reduckRequest<{ data: Run[] }>(ctx, 'GET', '/api/runs', {
			qs: { batch_id: batch.batch_id, page_size: BATCH },
		}));
	}
	// An item finds its run by position.
	if (runs.length !== items.length) {
		throw new NodeOperationError(ctx.getNode(), `Asked for ${items.length} runs, and Reduck answered for ${runs.length}`);
	}
	return runs;
}

// `versions` holds each script's current version, read once per execution.
async function itemRunOf(
	ctx: IExecuteFunctions,
	i: number,
	versions: Map<string, Promise<Script['current_version']>>,
): Promise<ItemRun> {
	const address = ctx.getNodeParameter('script', i, '', { extractValue: true }) as string;
	const script = await parseScriptAddress(ctx, address, ctx.getNodeParameter('handle', i, '') as string);
	if (!script) {
		throw new NodeOperationError(ctx.getNode(), `"${address}" is not a script address (host/slug or handle/host/slug)`, {
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
	if (!versions.has(address))
		versions.set(address, reduckRequest<Script>(ctx, 'GET', scriptPath(script)).then((s) => s.current_version));
	const version = await versions.get(address);
	const managed = ctx.getNodeParameter('browser', i) === 'managed';
	// A managed browser has no sign-in yet, so a script that needs one fails there.
	if (managed && version?.logged_in)
		throw new NodeOperationError(ctx.getNode(), 'Managed runs are not supported yet for scripts that require login', {
			itemIndex: i,
			description: 'Run it on a paired browser instead.',
		});
	const { region, country = '' } = ctx.getNodeParameter('options', i, {}) as { region?: string; country?: string };
	const deviceId = managed ? '' : (ctx.getNodeParameter('deviceId', i) as string);

	return {
		i,
		script: { ...script, args, ...(Object.keys(files).length ? { files } : {}) },
		// A paired browser, or the managed one with its options: never a mix the API refuses.
		target: managed
			? { ...(region ? { region } : {}), ...(country.trim() ? { country: country.trim() } : {}) }
			: deviceId === PAIRED_BROWSER
				? { browser: PAIRED_BROWSER }
				: { device_id: deviceId },
		// Declared by the script's author: `undetermined` may write, so it never runs twice.
		readOnly: version?.side_effects === 'none',
	};
}

const scriptOutput = (run: Run): IDataObject | null =>
	run.result && 'result' in run.result ? (run.result.result as IDataObject) : null;

// The run, with the script's output as `result` (the API wraps it as { result }).
const toItem = (run: Run): IDataObject => ({ ...run, result: scriptOutput(run) });

// What a workflow or an AI agent reads of a run: its output first, then where to see it.
const simplifyRun = (run: Run, url: string): IDataObject => ({
	result: scriptOutput(run),
	status: run.status,
	id: run.id,
	url,
	script: run.script ? `${run.script.handle}/${run.script.host}/${run.script.slug}` : null,
	started_at: run.started_at,
	finished_at: run.finished_at,
});
