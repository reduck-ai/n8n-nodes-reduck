import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

export const API_BASE_URL = 'https://reduck.ai';
export const MCP_URL = 'https://mcp.reduck.ai/mcp';

const MCP_PROTOCOL_VERSION = '2025-06-18';

/** Statuses a run can still leave. */
const PENDING_STATUSES = ['queued', 'running'];

type ReduckContext = IExecuteFunctions | ILoadOptionsFunctions;

/** Calls the Reduck REST API with the node's credential. */
export async function reduckApiRequest(
	this: ReduckContext,
	method: IHttpRequestMethods,
	endpoint: string,
	qs: IDataObject = {},
): Promise<IDataObject> {
	const options: IHttpRequestOptions = {
		method,
		url: `${API_BASE_URL}${endpoint}`,
		qs,
		json: true,
	};
	try {
		return (await this.helpers.httpRequestWithAuthentication.call(
			this,
			'reduckApi',
			options,
		)) as IDataObject;
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject);
	}
}

/**
 * Pages through a REST list endpoint (`{data, hasNextPage}`) until `limit`
 * items are collected, or every page when `limit` is 0.
 */
export async function reduckApiRequestAllItems(
	this: ReduckContext,
	endpoint: string,
	qs: IDataObject,
	limit: number,
): Promise<IDataObject[]> {
	const items: IDataObject[] = [];
	const pageSize = limit > 0 && limit < 100 ? limit : 100;
	let page = 0;
	let hasNextPage = true;
	while (hasNextPage) {
		const response = await reduckApiRequest.call(this, 'GET', endpoint, {
			...qs,
			page,
			pageSize,
		});
		items.push(...((response.data as IDataObject[]) ?? []));
		hasNextPage = response.hasNextPage === true;
		if (limit > 0 && items.length >= limit) return items.slice(0, limit);
		page++;
	}
	return items;
}

/** Returns the handle of the user the credential belongs to, e.g. "@jane". */
export async function getOwnHandle(this: ReduckContext): Promise<string> {
	const me = await reduckApiRequest.call(this, 'GET', '/api/me');
	if (typeof me.handle !== 'string' || me.handle === '') {
		throw new NodeOperationError(
			this.getNode(),
			'This Reduck account has no handle yet. Set one in your Reduck profile, or fill in Owner.',
		);
	}
	return me.handle.startsWith('@') ? me.handle : `@${me.handle}`;
}

/** Normalizes a script owner typed by the user: "jane" and "@jane" both work for users. */
export function ownerPath(owner: string): string {
	return encodeURIComponent(owner.trim());
}

/**
 * Reads one JSON-RPC message from an MCP Streamable HTTP response, which is
 * either plain JSON or a server-sent event stream.
 */
function parseMcpBody(body: string): IDataObject {
	const trimmed = body.trim();
	if (trimmed.startsWith('{')) return JSON.parse(trimmed) as IDataObject;
	const data = trimmed
		.split('\n')
		.filter((line) => line.startsWith('data:'))
		.map((line) => line.slice(5).trim())
		.filter((line) => line.startsWith('{'));
	for (const line of data) {
		const message = JSON.parse(line) as IDataObject;
		if ('result' in message || 'error' in message) return message;
	}
	return {};
}

async function mcpPost(
	this: IExecuteFunctions,
	payload: IDataObject,
	sessionId: string | undefined,
	timeout: number,
): Promise<{ body: IDataObject; sessionId?: string }> {
	const headers: IDataObject = {
		'Content-Type': 'application/json',
		Accept: 'application/json, text/event-stream',
		'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
	};
	if (sessionId) headers['Mcp-Session-Id'] = sessionId;
	try {
		const response = (await this.helpers.httpRequestWithAuthentication.call(this, 'reduckApi', {
			method: 'POST',
			url: MCP_URL,
			headers,
			body: JSON.stringify(payload),
			json: false,
			encoding: 'text',
			returnFullResponse: true,
			timeout,
		})) as { body: string; headers: IDataObject };
		const responseSession = response.headers['mcp-session-id'];
		return {
			body: response.body ? parseMcpBody(String(response.body)) : {},
			sessionId: typeof responseSession === 'string' ? responseSession : sessionId,
		};
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject);
	}
}

/**
 * Calls one tool on the Reduck MCP server: opens a session, calls the tool,
 * then closes the session. Returns the tool's structured result.
 */
export async function callReduckTool(
	this: IExecuteFunctions,
	name: string,
	args: IDataObject,
	timeout: number,
): Promise<IDataObject> {
	const init = await mcpPost.call(
		this,
		{
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: {
				protocolVersion: MCP_PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: 'n8n-nodes-reduck', version: '0.1.0' },
			},
		},
		undefined,
		30000,
	);
	if (init.body.error) {
		throw new NodeApiError(this.getNode(), init.body.error as JsonObject);
	}
	const sessionId = init.sessionId;
	await mcpPost.call(this, { jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId, 30000);

	const call = await mcpPost.call(
		this,
		{ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } },
		sessionId,
		timeout,
	);

	if (sessionId) {
		try {
			await this.helpers.httpRequestWithAuthentication.call(this, 'reduckApi', {
				method: 'DELETE',
				url: MCP_URL,
				headers: { 'Mcp-Session-Id': sessionId },
			});
		} catch {
			// The server expires idle sessions on its own.
		}
	}

	if (call.body.error) {
		throw new NodeApiError(this.getNode(), call.body.error as JsonObject);
	}
	const result = (call.body.result ?? {}) as IDataObject;
	const content = (result.content as IDataObject[] | undefined) ?? [];
	const text = content
		.filter((part) => part.type === 'text')
		.map((part) => part.text)
		.join('\n');
	if (result.isError === true) {
		throw new NodeOperationError(this.getNode(), text || `Reduck tool ${name} failed`);
	}
	if (result.structuredContent) return result.structuredContent as IDataObject;
	return { text };
}

/** Shapes a run read from the REST API like the output of Run Script. */
export function simplifyRun(run: IDataObject): IDataObject {
	const outcome = (run.result ?? {}) as IDataObject;
	const script = (run.script ?? {}) as IDataObject;
	return {
		runId: run.id,
		status: run.status,
		script: script.host ? `${script.handle}/${script.host}/${script.slug}` : run.name,
		result: outcome.result ?? null,
		error: outcome.error ?? null,
		startedAt: run.started_at,
		finishedAt: run.finished_at ?? null,
	};
}

/**
 * Waits for a run to leave the queued/running states, reading it from the
 * REST API every few seconds, until `maxWaitSeconds` have passed.
 */
export async function waitForRun(
	this: IExecuteFunctions,
	runId: string,
	maxWaitSeconds: number,
	firstDelayMs: number,
): Promise<IDataObject> {
	const deadline = Date.now() + maxWaitSeconds * 1000;
	let delay = Math.min(Math.max(firstDelayMs, 1000), 10000);
	for (;;) {
		await sleep(delay);
		const run = simplifyRun(
			await reduckApiRequest.call(this, 'GET', `/api/runs/${encodeURIComponent(runId)}`),
		);
		if (!PENDING_STATUSES.includes(String(run.status)) || Date.now() + delay > deadline) {
			return run;
		}
		delay = Math.min(delay * 1.5, 10000);
	}
}
