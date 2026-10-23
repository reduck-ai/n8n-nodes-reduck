import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeListSearchResult,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	callReduckTool,
	getOwnHandle,
	ownerPath,
	reduckApiRequest,
	reduckApiRequestAllItems,
	simplifyRun,
	waitForRun,
} from './GenericFunctions';
import { runFields, runOperations } from './descriptions/RunDescription';
import { scriptFields, scriptOperations } from './descriptions/ScriptDescription';

/**
 * Programmatic style: running a script needs several dependent calls (an MCP
 * session with the run_script tool, then polling the run on the REST API until
 * it finishes), which declarative routing cannot express.
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
			): Promise<INodeListSearchResult> {
				const handle = await getOwnHandle.call(this);
				const qs: IDataObject = { archived: 'false' };
				if (filter) qs.q = filter;
				const scripts = await reduckApiRequestAllItems.call(
					this,
					`/api/scripts/${ownerPath(handle)}`,
					qs,
					100,
				);
				return {
					results: scripts.map((script) => ({
						name: `${script.host}/${script.slug} — ${script.name}`,
						value: `${script.host}/${script.slug}`,
						url: `https://reduck.ai/scripts/${handle}/${script.host}/${script.slug}`,
					})),
				};
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
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
					const handle = owner || (await getOwnHandle.call(this));
					const scripts = await reduckApiRequestAllItems.call(
						this,
						`/api/scripts/${ownerPath(handle)}`,
						qs,
						limit,
					);
					for (const script of scripts) {
						returnData.push({ json: script, pairedItem: { item: i } });
					}
					continue;
				}

				if (resource === 'script' && operation === 'get') {
					const { owner, host, slug } = await resolveScript.call(this, i);
					const script = await reduckApiRequest.call(
						this,
						'GET',
						`/api/scripts/${ownerPath(owner ?? (await getOwnHandle.call(this)))}/${encodeURIComponent(host)}/${encodeURIComponent(slug)}`,
					);
					returnData.push({ json: script, pairedItem: { item: i } });
					continue;
				}

				if (resource === 'script' && operation === 'run') {
					const { owner, host, slug } = await resolveScript.call(this, i);
					const scriptArgs = parseArguments.call(this, i);
					const options = this.getNodeParameter('options', i, {}) as IDataObject;
					const waitForCompletion = this.getNodeParameter('waitForCompletion', i, true) as boolean;
					const maxWait = (options.maxWaitSeconds as number | undefined) ?? 300;

					const target: IDataObject = { host, slug, args: scriptArgs };
					if (owner) target.handle = owner;
					const args: IDataObject = {
						script: target,
						fullOutput: true,
						waitForSeconds: waitForCompletion ? Math.min(55, maxWait) : 0,
					};
					const browser = (options.browser as string | undefined) ?? 'managed';
					if (browser === 'device') {
						if (!options.deviceId) {
							throw new NodeOperationError(this.getNode(), 'Set Device ID to run on one paired device', {
								itemIndex: i,
							});
						}
						args.deviceId = options.deviceId;
					} else {
						args.browser = browser;
					}
					if (browser === 'managed' && options.country) args.country = options.country;

					const envelope = await callReduckTool.call(this, 'run_script', args, 90000);
					let run: IDataObject = {
						runId: envelope.runId,
						status: normalizeStatus(envelope.status),
						script: owner ? `${owner}/${host}/${slug}` : `${host}/${slug}`,
						result: envelope.result ?? null,
						error: envelope.error ?? null,
					};
					if (
						waitForCompletion &&
						['queued', 'running'].includes(String(run.status)) &&
						typeof run.runId === 'string'
					) {
						run = await waitForRun.call(
							this,
							run.runId,
							maxWait,
							(envelope.retryAfterMs as number | undefined) ?? 3000,
						);
					}
					if (run.status === 'error' && options.failOnScriptError !== false) {
						throw new NodeOperationError(
							this.getNode(),
							`Reduck run ${run.runId} failed: ${stringifyError(run.error)}`,
							{ itemIndex: i },
						);
					}
					returnData.push({ json: run, pairedItem: { item: i } });
					continue;
				}

				if (resource === 'run' && operation === 'get') {
					const runId = this.getNodeParameter('runId', i) as string;
					const run = await reduckApiRequest.call(
						this,
						'GET',
						`/api/runs/${encodeURIComponent(runId.trim())}`,
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
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}

/**
 * Reads the Script parameter: "host/slug" for your own script, or
 * "@owner/host/slug" (or "project/host/slug") for a script someone else shares.
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

/** Maps the MCP run statuses onto the REST API ones, so both outputs match. */
function normalizeStatus(status: unknown): string {
	if (status === 'completed') return 'success';
	if (status === 'failed') return 'error';
	return String(status);
}

function stringifyError(error: unknown): string {
	if (typeof error === 'string') return error;
	if (error && typeof error === 'object' && 'message' in error) {
		return String((error as { message: unknown }).message);
	}
	return JSON.stringify(error);
}
