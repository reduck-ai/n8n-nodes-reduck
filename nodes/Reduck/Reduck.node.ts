import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeListSearchResult,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	getOwnHandle,
	getRun,
	isNotFound,
	pathSegment,
	PENDING_STATUSES,
	reduckApiRequest,
	reduckApiRequestAllItems,
	simplifyRun,
	startRun,
	waitForRun,
} from './GenericFunctions';
import { runFields, runOperations } from './descriptions/RunDescription';
import { scriptFields, scriptOperations } from './descriptions/ScriptDescription';

/**
 * Programmatic style: running a script needs several dependent calls (start
 * the run, then poll it on the REST API until it finishes), which declarative
 * routing cannot express.
 */
export class Reduck implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Reduck',
		name: 'reduck',
		icon: { light: 'file:reduck.svg', dark: 'file:reduck.dark.svg' },
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Run your saved Reduck browser scripts and read their results',
		defaults: {
			name: 'Reduck',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'reduckApi',
				required: true,
			},
		],
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
			...scriptOperations,
			...scriptFields,
			...runOperations,
			...runFields,
		],
	};

	methods = {
		listSearch: {
			async searchScripts(
				this: ILoadOptionsFunctions,
				filter?: string,
				paginationToken?: string,
			): Promise<INodeListSearchResult> {
				const handle = await getOwnHandle.call(this);
				const page = paginationToken ? Number(paginationToken) : 0;
				const qs: IDataObject = { archived: 'false', page, pageSize: 100 };
				if (filter) qs.q = filter;
				const response = await reduckApiRequest.call(
					this,
					'GET',
					`/api/scripts/${pathSegment.call(this, handle)}`,
					qs,
				);
				const scripts = (response.data as IDataObject[]) ?? [];
				return {
					results: scripts.map((script) => ({
						name: `${script.host}/${script.slug} — ${script.name}`,
						value: `${script.host}/${script.slug}`,
						// Only public scripts have a page on reduck.ai.
						url:
							script.visibility === 'public'
								? `https://reduck.ai/explore/scripts/${handle}/${script.host}/${script.slug}`
								: undefined,
					})),
					paginationToken: response.hasNextPage === true ? String(page + 1) : undefined,
				};
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		let ownHandle: string | undefined;
		const own = async () => (ownHandle ??= await getOwnHandle.call(this));

		for (let i = 0; i < items.length; i++) {
			// The run started for this item, kept so an error output still says which run failed.
			let currentRun: IDataObject | undefined;
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				if (resource === 'script' && operation === 'getAll') {
					const owner = (this.getNodeParameter('owner', i, '') as string).trim();
					const returnAll = this.getNodeParameter('returnAll', i) as boolean;
					const limit = returnAll ? 0 : (this.getNodeParameter('limit', i) as number);
					const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
					const qs: IDataObject = {};
					if (filters.host) qs.host = filters.host;
					if (filters.search) qs.q = filters.search;
					if (filters.visibility) qs.visibility = filters.visibility;
					qs.archived = filters.includeArchived === true ? undefined : 'false';
					const scripts = (await withOwnerFallback.call(this, owner || (await own()), async (handle) =>
						reduckApiRequestAllItems.call(
							this,
							`/api/scripts/${pathSegment.call(this, handle, i)}`,
							qs,
							limit,
						),
					)) as IDataObject[];
					for (const script of scripts) {
						returnData.push({ json: script, pairedItem: { item: i } });
					}
					continue;
				}

				if (resource === 'script' && operation === 'get') {
					const { owner, host, slug } = await resolveScript.call(this, i);
					const script = (await withOwnerFallback.call(this, owner ?? (await own()), async (handle) =>
						reduckApiRequest.call(
							this,
							'GET',
							`/api/scripts/${pathSegment.call(this, handle, i)}/${pathSegment.call(this, host, i)}/${pathSegment.call(this, slug, i)}`,
						),
					)) as IDataObject;
					returnData.push({ json: script, pairedItem: { item: i } });
					continue;
				}

				if (resource === 'script' && operation === 'run') {
					const { owner, host, slug } = await resolveScript.call(this, i);
					const scriptArgs = parseArguments.call(this, i);
					const options = this.getNodeParameter('options', i, {}) as IDataObject;
					const waitForCompletion = this.getNodeParameter('waitForCompletion', i, true) as boolean;
					const maxWait = (options.maxWaitSeconds as number | undefined) ?? 300;
					const failOnError = options.failOnScriptError !== false;

					const spec: IDataObject = {};
					// Without a browser, Reduck picks the user's paired browser.
					const browser = (options.browser as string | undefined) ?? 'default';
					const deviceId = ((options.deviceId as string | undefined) ?? '').trim();
					if (browser === 'device' || deviceId) {
						if (!deviceId) {
							throw new NodeOperationError(this.getNode(), 'Set Device ID to run on one paired device', {
								itemIndex: i,
							});
						}
						spec.deviceId = deviceId;
					} else if (browser !== 'default') {
						spec.browser = browser;
					}
					if (options.country) {
						if (spec.browser !== 'managed') {
							throw new NodeOperationError(
								this.getNode(),
								'Country only works with the browser hosted by Reduck: set Browser to "Hosted by Reduck"',
								{ itemIndex: i },
							);
						}
						spec.country = options.country;
					}

					const deadline = Date.now() + maxWait * 1000;
					const serverWait = waitForCompletion ? Math.min(55, maxWait) : 0;
					const started = owner
						? ((await withOwnerFallback.call(this, owner, async (handle) =>
								startRun.call(
									this,
									{ ...spec, script: { host, slug, handle, args: scriptArgs } },
									serverWait,
								),
							)) as IDataObject)
						: await startRun.call(this, { ...spec, script: { host, slug, args: scriptArgs } }, serverWait);
					const runId = typeof started.runId === 'string' ? started.runId : undefined;
					currentRun = {
						runId: runId ?? null,
						status: started.error ? 'error' : String(started.status ?? 'success'),
						script: `${owner ? `${owner}/` : ''}${host}/${slug}`,
						result: started.result ?? null,
						error: started.externalMessage ?? started.error ?? null,
						startedAt: null,
						finishedAt: null,
					};
					if (runId) {
						// Read the run record so the output has the same fields however long the
						// run took; poll first if it outlived the run service's wait.
						let polled: IDataObject | undefined;
						if (waitForCompletion && PENDING_STATUSES.includes(String(currentRun.status))) {
							polled = await waitForRun.call(this, runId, deadline);
						}
						try {
							currentRun = polled ?? (await getRun.call(this, runId));
						} catch {
							// Keep what the run service answered.
						}
					}

					const status = String(currentRun.status);
					if (failOnError && waitForCompletion && PENDING_STATUSES.includes(status)) {
						throw new NodeOperationError(
							this.getNode(),
							`Reduck run ${runId} is still ${status} after ${maxWait} s`,
							{
								itemIndex: i,
								description:
									'Raise Max Wait, or turn off Wait for Completion and read the run later with Run → Get.',
							},
						);
					}
					if (failOnError && (status === 'error' || status === 'cancelled')) {
						throw new NodeOperationError(
							this.getNode(),
							`Reduck run ${runId ?? ''} ${status === 'cancelled' ? 'was cancelled' : 'failed'}: ${stringifyError(currentRun.error)}`,
							{ itemIndex: i },
						);
					}
					returnData.push({ json: currentRun, pairedItem: { item: i } });
					continue;
				}

				if (resource === 'run' && operation === 'get') {
					const runId = this.getNodeParameter('runId', i) as string;
					const run = await reduckApiRequest.call(
						this,
						'GET',
						`/api/runs/${pathSegment.call(this, runId, i)}`,
					);
					const simplify = this.getNodeParameter('simplify', i, true) as boolean;
					returnData.push({ json: simplify ? simplifyRun(run) : run, pairedItem: { item: i } });
					continue;
				}

				if (resource === 'run' && operation === 'getAll') {
					const returnAll = this.getNodeParameter('returnAll', i) as boolean;
					const limit = returnAll ? 0 : (this.getNodeParameter('limit', i) as number);
					const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
					const simplify = this.getNodeParameter('simplify', i, true) as boolean;
					const qs: IDataObject = {};
					if (filters.status) qs.status = filters.status;
					if (filters.host) qs.host = filters.host;
					const runs = await reduckApiRequestAllItems.call(this, '/api/runs', qs, limit);
					for (const run of runs) {
						returnData.push({ json: simplify ? simplifyRun(run) : run, pairedItem: { item: i } });
					}
					continue;
				}

				throw new NodeOperationError(
					this.getNode(),
					`The operation "${operation}" is not supported for "${resource}"`,
					{ itemIndex: i },
				);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { ...(currentRun ?? {}), error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				// Re-wrapping a NodeApiError or NodeOperationError hands back the same
				// object, so the item index has to be set on it first.
				if (error instanceof NodeApiError) {
					error.context.itemIndex ??= i;
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject);
				}
				if (error instanceof NodeOperationError) {
					error.context.itemIndex ??= i;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}

/**
 * Runs `request` for `owner`. A name without "@" is a project handle first;
 * when no project has it, the user "@name" is tried.
 */
async function withOwnerFallback<T>(
	this: IExecuteFunctions,
	owner: string,
	request: (handle: string) => Promise<T>,
): Promise<T> {
	try {
		return await request(owner);
	} catch (error) {
		if (!isNotFound(error) || owner.startsWith('@')) {
			throw new NodeApiError(this.getNode(), error as JsonObject);
		}
		return await request(`@${owner}`);
	}
}

/**
 * Reads the Script parameter: "host/slug" for your own script, or
 * "owner/host/slug" for a script someone else shares.
 */
async function resolveScript(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<{ owner?: string; host: string; slug: string }> {
	const value = (
		this.getNodeParameter('script', itemIndex, '', { extractValue: true }) as string
	).trim();
	const parts = value.split('/').filter((part) => part !== '');
	if (parts.length === 2) return { host: parts[0], slug: parts[1] };
	if (parts.length === 3) return { owner: parts[0], host: parts[1], slug: parts[2] };
	throw new NodeOperationError(
		this.getNode(),
		`Script "${value}" is not valid. Use "host/slug", for example "example.com/get_prices".`,
		{ itemIndex },
	);
}

function parseArguments(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const raw = this.getNodeParameter('scriptArguments', itemIndex, '{}') as string | IDataObject;
	if (typeof raw === 'object' && raw !== null) return raw;
	if (raw.trim() === '') return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
			return parsed as IDataObject;
		}
	} catch {
		// Reported below.
	}
	throw new NodeOperationError(this.getNode(), 'Script Arguments must be a JSON object', {
		itemIndex,
	});
}

function stringifyError(error: unknown): string {
	if (typeof error === 'string') return error;
	if (error && typeof error === 'object' && 'message' in error) {
		return String((error as { message: unknown }).message);
	}
	return JSON.stringify(error);
}
