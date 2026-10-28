import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	ILoadOptionsFunctions,
} from 'n8n-workflow';

// The one place this package calls Reduck. The credential adds the API key; the base URL comes
// from the credential too, so the same node works against any Reduck environment.
export async function reduckRequest<T>(
	ctx: IExecuteFunctions | ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	path: string,
	options: { body?: IDataObject; qs?: IDataObject } = {},
): Promise<T> {
	const credentials = await ctx.getCredentials('reduckApi');
	const baseUrl = String(credentials.baseUrl).replace(/\/+$/, '');
	return (await ctx.helpers.httpRequestWithAuthentication.call(ctx, 'reduckApi', {
		method,
		url: `${baseUrl}${path}`,
		json: true,
		...options,
	})) as T;
}

// A script is addressed as "<handle>/<host>/<slug>", e.g. "reduck/example.com/noop".
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
