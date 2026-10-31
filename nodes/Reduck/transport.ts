import {
	NodeApiError,
	type IDataObject,
	type IExecuteFunctions,
	type IHttpRequestMethods,
	type ILoadOptionsFunctions,
	type JsonObject,
} from 'n8n-workflow';

type Ctx = IExecuteFunctions | ILoadOptionsFunctions;

// The credential the node's Authentication field names. A dropdown reads the form being edited;
// an execution reads the saved node.
const credentialOf = (ctx: Ctx): string => {
	const authentication =
		'getCurrentNodeParameter' in ctx
			? ctx.getCurrentNodeParameter('authentication')
			: ctx.getNodeParameter('authentication', 0);
	return authentication === 'oAuth2' ? 'reduckOAuth2Api' : 'reduckApi';
};

// The Reduck environment the credential names: its API and its pages share this origin. The API
// key credential has a URL field; the OAuth2 one signs in at its server URL. A credential saved
// before the URL field existed has neither, and means production.
export async function reduckUrl(ctx: Ctx): Promise<string> {
	const { url, serverUrl } = await ctx.getCredentials<{ url?: string; serverUrl?: string }>(
		credentialOf(ctx),
	);
	return (url || serverUrl || 'https://reduck.ai').replace(/\/+$/, '');
}

// The one place this package calls Reduck. The credential adds the API key or the OAuth token.
export async function reduckRequest<T>(
	ctx: Ctx,
	method: IHttpRequestMethods,
	path: string,
	options: { body?: IDataObject; qs?: IDataObject } = {},
): Promise<T> {
	const url = `${await reduckUrl(ctx)}${path}`;
	try {
		return (await ctx.helpers.httpRequestWithAuthentication.call(ctx, credentialOf(ctx), {
			method,
			url,
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

// A script is addressed as "<handle>/<host>/<slug>", e.g. "reduck/google.com/get_ai_overview".
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
