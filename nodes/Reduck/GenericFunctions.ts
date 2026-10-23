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
/** Starts a run: the endpoint the Reduck CLI uses, on the run service. */
export const RUN_URL = 'https://mcp.reduck.ai/run';

/** Statuses a run can still leave. */
export const PENDING_STATUSES = ['queued', 'running'];

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
		timeout: 30000,
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

/**
 * Encodes one path segment typed by the user (an owner, host, slug or run ID).
 * A user owner needs its "@" ("@jane"); without it the name is read as a project.
 */
export function pathSegment(this: ReduckContext, value: string, itemIndex?: number): string {
	const segment = value.trim();
	if (segment === '' || segment === '.' || segment === '..' || segment.includes('/')) {
		throw new NodeOperationError(this.getNode(), `"${value}" is not a valid name or ID`, {
			itemIndex,
		});
	}
	return encodeURIComponent(segment);
}

export function isNotFound(error: unknown): boolean {
	return (error as { httpCode?: string }).httpCode === '404';
}

/**
 * Starts a run and lets the run service wait up to `waitForSeconds` (at most
 * 60) for it to finish. The answer is `{runId, result}` or `{runId, error}` for
 * a finished run, `{runId, status: "queued" | "running"}` for one still going,
 * or `{error}` when the run cannot start (unknown script, no device). The HTTP
 * timeout is longer than that wait, so the runId is only lost if the
 * connection drops mid-call.
 */
export async function startRun(
	this: IExecuteFunctions,
	spec: IDataObject,
	waitForSeconds: number,
): Promise<IDataObject> {
	let response: { statusCode: number; body: IDataObject };
	try {
		response = (await this.helpers.httpRequestWithAuthentication.call(this, 'reduckApi', {
			method: 'POST',
			url: RUN_URL,
			body: { ...spec, waitForSeconds },
			json: true,
			timeout: (waitForSeconds + 30) * 1000,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
		})) as { statusCode: number; body: IDataObject };
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject, {
			message: 'Could not reach Reduck to start the run',
			description:
				'If the connection dropped after the request was sent, the run may have started: check Run → Get Many before running the node again.',
		});
	}
	const body = response.body ?? {};
	if (response.statusCode === 401 || response.statusCode === 403) {
		throw new NodeApiError(this.getNode(), {} as JsonObject, {
			httpCode: String(response.statusCode),
			message: 'Authorization failed: check the API key of your Reduck credential',
		});
	}
	if (response.statusCode >= 400 && typeof body.runId !== 'string') {
		// Drop the hint meant for AI agents ("not found — read_script(...)").
		const reason = String(body.error ?? `HTTP ${response.statusCode}`).split(' — ')[0];
		throw new NodeApiError(this.getNode(), {} as JsonObject, {
			httpCode: String(response.statusCode),
			message: `Reduck could not start the run: ${reason}`,
		});
	}
	return body;
}

/** Shapes a run read from the REST API as the node's run output. */
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

/** Reads one run from the REST API, shaped as the node's run output. */
export async function getRun(this: IExecuteFunctions, runId: string): Promise<IDataObject> {
	return simplifyRun(
		await reduckApiRequest.call(this, 'GET', `/api/runs/${encodeURIComponent(runId)}`),
	);
}

/**
 * Waits until `deadline` (a timestamp) for a run to leave the queued/running
 * states, reading it from the REST API. Network errors, 429 and 5xx are
 * retried on the next tick rather than failing the node, since a failure here
 * would make n8n's Retry On Fail start the script a second time. Other errors
 * (401, 404) stop the wait. Stopping the execution in n8n stops the wait too;
 * the run itself goes on in Reduck.
 */
export async function waitForRun(
	this: IExecuteFunctions,
	runId: string,
	deadline: number,
): Promise<IDataObject | undefined> {
	const signal = this.getExecutionCancelSignal?.();
	let delay = 1000;
	let last: IDataObject | undefined;
	while (Date.now() + delay <= deadline && !signal?.aborted) {
		await sleep(delay);
		try {
			last = await getRun.call(this, runId);
			if (!PENDING_STATUSES.includes(String(last.status))) return last;
		} catch (error) {
			const code = Number((error as { httpCode?: string }).httpCode);
			if (code && code !== 429 && code < 500) {
				throw new NodeApiError(this.getNode(), error as JsonObject);
			}
		}
		delay = Math.min(delay * 1.5, 10000);
	}
	return last;
}
