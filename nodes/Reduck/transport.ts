import {
	NodeApiError,
	type IDataObject,
	type IExecuteFunctions,
	type IHttpRequestMethods,
	type ILoadOptionsFunctions,
	type JsonObject,
} from 'n8n-workflow';

type Ctx = IExecuteFunctions | ILoadOptionsFunctions;

// The Reduck environment the credential names: its API and its pages share this origin. A
// credential saved before the URL field existed has none, and means production.
export async function reduckUrl(ctx: Ctx): Promise<string> {
	const { url } = await ctx.getCredentials<{ url?: string }>('reduckApi');
	return (url || 'https://reduck.ai').replace(/\/+$/, '');
}

// The one place this package calls Reduck. The credential adds the API key or the OAuth token; the
// User-Agent is how Reduck tells a run of this node from another REST call.
export async function reduckRequest<T>(
	ctx: Ctx,
	method: IHttpRequestMethods,
	path: string,
	options: { body?: IDataObject; qs?: IDataObject } = {},
): Promise<T> {
	const url = `${await reduckUrl(ctx)}${path}`;
	try {
		return (await ctx.helpers.httpRequestWithAuthentication.call(ctx, 'reduckApi', {
			method,
			url,
			headers: { 'User-Agent': 'n8n-nodes-reduck' },
			json: true,
			...options,
		})) as T;
	} catch (error) {
		// The API says what went wrong in `{ error }`. n8n's helper has already wrapped the HTTP
		// error in a NodeApiError with a generic sentence for the status code, so the API's sentence
		// is read from the original, its `cause`. Not `instanceof NodeApiError`: n8n throws its own
		// copy of the class, never the one this package imports.
		const original = (error as { cause?: unknown }).cause ?? error;
		const answer = (original as { response?: { data?: { error?: unknown } } }).response?.data;
		throw new NodeApiError(
			ctx.getNode(),
			original as JsonObject,
			typeof answer?.error === 'string' ? { message: answer.error } : {},
		);
	}
}

// The account's own handle, read once per execution or dropdown load.
const ownHandles = new WeakMap<Ctx, Promise<string>>();

// A script is addressed as "<handle>/<host>/<slug>", e.g. "reduck/google.com/get_ai_overview", or
// as "<host>/<slug>" under `handle`: the account's own when it is empty, as the MCP's run_script.
export async function parseScriptAddress(
	ctx: Ctx,
	address: string,
	handle: string,
): Promise<{ handle: string; host: string; slug: string } | null> {
	const parts = address.trim().split('/');
	if (parts.length === 2) {
		if (!handle && !ownHandles.has(ctx))
			ownHandles.set(
				ctx,
				reduckRequest<{ handle: string | null }>(ctx, 'GET', '/api/me').then((me) => me.handle ?? ''),
			);
		parts.unshift(handle || ((await ownHandles.get(ctx)) ?? ''));
	}
	const [owner, host, slug] = parts;
	if (!owner || !host || !slug || parts.length > 3) return null;
	return { handle: owner, host, slug };
}

export const scriptPath = ({ handle, host, slug }: { handle: string; host: string; slug: string }) =>
	`/api/scripts/${[handle, host, slug].map(encodeURIComponent).join('/')}`;

// The parts of a run this package reads (GET /api/runs/{run_id} answers more).
export interface Run {
	id: string;
	status: 'queued' | 'running' | 'success' | 'error' | 'cancelled';
	result: { result: unknown } | { error: string } | null;
	started_at: string;
	finished_at: string | null;
	/** What the user can do about a failure, when Reduck knows. */
	external_message: string | null;
	/** Null when the script was deleted. */
	script: { handle: string; host: string; slug: string } | null;
	[key: string]: unknown;
}
