import {
	NodeApiError,
	type IDataObject,
	type IExecuteFunctions,
	type IHttpRequestMethods,
	type ILoadOptionsFunctions,
	type JsonObject,
} from 'n8n-workflow';

// Reduck's API and its pages share this origin.
export const REDUCK_URL = 'https://reduck.ai';

// The one place this package calls Reduck. The credential adds the API key.
export async function reduckRequest<T>(
	ctx: IExecuteFunctions | ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	path: string,
	options: { body?: IDataObject; qs?: IDataObject } = {},
): Promise<T> {
	try {
		return (await ctx.helpers.httpRequestWithAuthentication.call(ctx, 'reduckApi', {
			method,
			url: `${REDUCK_URL}${path}`,
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

// A script is addressed as "<handle>/<host>/<slug>", e.g. "reduck/news.ycombinator.com/top_stories".
export function parseScriptAddress(address: string): { handle: string; host: string; slug: string } | null {
	const [handle, host, slug, ...rest] = address.trim().split('/');
	if (!handle || !host || !slug || rest.length) return null;
	return { handle, host, slug };
}

// The parts of a run this package reads (GET /api/runs/{run_id} answers more).
export interface Run {
	id: string;
	status: 'queued' | 'running' | 'success' | 'error' | 'cancelled';
	result: { result: unknown } | { error: string } | null;
	started_at: string;
	finished_at: string | null;
	[key: string]: unknown;
}
