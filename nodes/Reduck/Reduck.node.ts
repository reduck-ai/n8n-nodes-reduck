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
	cleanError,
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
					if (filters.host) qs.host = hostOf(filters.host as string);
					if (filters.search) qs.q = filters.search;
					if (filters.visibility) qs.visibility = filters.visibility;
					qs.archived = filters.includeArchived === true ? undefined : 'false';
					const scripts = (await withOwnerFallback.call(this, owner || (await own()), async (handle) => {
						const found = await reduckApiRequestAllItems.call(
							this,
							`/api/scripts/${pathSegment.call(this, handle, i)}`,
							qs,
							limit,
						);
						// "@team" for a project lists nothing rather than failing: treat it as not found.
						if (found.length === 0 && handle.startsWith('@') && owner) throw notFoundError(this);
						return found;
					})) as IDataObject[];
					const simplify = this.getNodeParameter('simplify', i, true) as boolean;
					for (const script of scripts) {
						returnData.push({
							json: simplify ? simplifyScript(script, false) : script,
							pairedItem: { item: i },
						});
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
					const simplify = this.getNodeParameter('simplify', i, true) as boolean;
					returnData.push({
						json: simplify ? simplifyScript(script, true) : script,
						pairedItem: { item: i },
					});
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
					const browser = this.getNodeParameter('browser', i, 'default') as string;
					if (browser === 'device') {
						const deviceId = (this.getNodeParameter('deviceId', i, '') as string).trim();
						if (!deviceId) {
							throw new NodeOperationError(this.getNode(), 'Device ID is empty', {
								itemIndex: i,
								description: 'Set Device ID to the ID of one of your paired devices.',
							});
						}
						spec.deviceId = deviceId;
					} else if (browser !== 'default') {
						spec.browser = browser;
					}
					if (browser === 'managed') {
						const country = (this.getNodeParameter('country', i, '') as string).trim();
						if (country) spec.country = country;
					}

					const deadline = Date.now() + maxWait * 1000;
					const serverWait = waitForCompletion ? Math.min(55, maxWait) : 0;
					const start = async (handle?: string) =>
						await startRun.call(
							this,
							{ ...spec, script: { host, slug, ...(handle ? { handle } : {}), args: scriptArgs } },
							serverWait,
						);
					let started = await start(owner);
					if (owner && started.httpCode === 404) started = await start(otherOwnerForm(owner));
					const scriptPath = `${owner ? `${owner}/` : ''}${host}/${slug}`;
					if (started.startError) {
						// The run could not start (unknown script, invalid arguments, no device).
						currentRun = { runId: null, status: 'error', script: scriptPath, result: null };
						currentRun.error = started.startError;
						if (failOnError) {
							throw new NodeOperationError(this.getNode(), 'Could not start run', {
								itemIndex: i,
								description: String(started.startError),
							});
						}
						returnData.push({
							json: { ...currentRun, startedAt: null, finishedAt: null },
							pairedItem: { item: i },
						});
						continue;
					}
					const runId = typeof started.runId === 'string' ? started.runId : undefined;
					currentRun = {
						runId: runId ?? null,
						status: started.error ? 'error' : String(started.status ?? 'success'),
						script: scriptPath,
						result: started.result ?? null,
						error: cleanError(started.externalMessage ?? started.error),
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
						throw new NodeOperationError(this.getNode(), `Run still ${status} after ${maxWait} s`, {
							itemIndex: i,
							description: `Run ${runId} goes on in Reduck. Raise 'Max Wait (Seconds)', or turn off 'Wait for Completion' and read the run later with Run → Get.`,
						});
					}
					if (failOnError && (status === 'error' || status === 'cancelled')) {
						throw new NodeOperationError(
							this.getNode(),
							status === 'cancelled' ? 'Run was cancelled' : 'Run failed',
							{
								itemIndex: i,
								description: `${stringifyError(currentRun.error)} (run ${runId ?? 'unknown'})`,
							},
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
					if (filters.host) qs.host = hostOf(filters.host as string);
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
					const description = (error as { description?: string }).description;
					returnData.push({
						json: {
							...(currentRun ?? {}),
							status: currentRun?.status ?? 'error',
							error: description ? `${(error as Error).message}: ${description}` : (error as Error).message,
						},
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

/** "jane" ⇄ "@jane": a user handle has an "@", a project handle has none. */
function otherOwnerForm(owner: string): string {
	return owner.startsWith('@') ? owner.slice(1) : `@${owner}`;
}

function notFoundError(context: IExecuteFunctions): NodeApiError {
	return new NodeApiError(context.getNode(), {} as JsonObject, {
		httpCode: '404',
		message: 'Not found',
	});
}

/**
 * Runs `request` for `owner`, and on "not found" once more with the other form
 * of the name, so "reduck" and "@reduck", "jane" and "@jane" all work.
 */
async function withOwnerFallback<T>(
	this: IExecuteFunctions,
	owner: string,
	request: (handle: string) => Promise<T>,
): Promise<T> {
	try {
		return await request(owner);
	} catch (error) {
		if (!isNotFound(error)) throw new NodeApiError(this.getNode(), error as JsonObject);
		return await request(otherOwnerForm(owner));
	}
}

/** "https://www.example.com/page" → "example.com", as the host filter expects. */
function hostOf(value: string): string {
	return value
		.trim()
		.replace(/^[a-z]+:\/\//i, '')
		.split(/[/?#]/)[0]
		.replace(/^www\./i, '')
		.toLowerCase();
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
		`Script "${value}" is not valid. Use "host/slug", for example "example.com/export_orders".`,
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

/** At most 10 fields, as the n8n UX guidelines ask for Simplify. */
function simplifyScript(script: IDataObject, withInputs: boolean): IDataObject {
	const author = (script.author ?? {}) as IDataObject;
	const version = (script.current_version ?? {}) as IDataObject;
	const simple: IDataObject = {
		script: `${author.handle}/${script.host}/${script.slug}`,
		name: script.name,
		description: script.description,
		visibility: script.visibility,
		sideEffects: version.side_effects ?? null,
		loggedIn: version.logged_in ?? null,
		successRate: script.success_rate ?? null,
		lastRunAt: script.last_run_at ?? null,
		archived: script.archived_at != null,
	};
	if (withInputs) simple.inputSchema = version.input_schema ?? null;
	return simple;
}

function stringifyError(error: unknown): string {
	if (typeof error === 'string') return error;
	if (error && typeof error === 'object' && 'message' in error) {
		return String((error as { message: unknown }).message);
	}
	return JSON.stringify(error);
}
