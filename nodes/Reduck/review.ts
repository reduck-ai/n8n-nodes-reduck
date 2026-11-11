import {
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	type IPollFunctions,
} from 'n8n-workflow';

import { flockUrl, ownHandle, reduckRequest } from './transport';

// The account's install of the Reduck app `reduck/n8n_app` holds the prompts this node names, and
// the decisions the model makes under them, which a person approves or rejects on the app's page.
// This file only calls what Reduck already serves: its apps API, and flock's
// `/api/apps/<id>/decide`, the door of the `reduck flock` CLI.

const IMAGE = { handle: 'reduck', slug: 'n8n_app' };

type Ctx = IExecuteFunctions | IPollFunctions;

export const PROMPT: INodeProperties = {
	displayName: 'Prompt',
	name: 'prompt',
	type: 'string',
	default: '',
	required: true,
	placeholder: 'e.g. Reddit replies',
	description: 'The name of the prompt in your n8n_app. Set Prompt creates it when it does not exist.',
};

const ANSWER = JSON.stringify(
	{ type: 'object', required: ['reply'], properties: { reply: { type: 'string' } } },
	null,
	2,
);

const show = { show: { resource: ['review'] } };
// Set Prompt writes a prompt, Request Review only answers under its live version: a version
// promoted elsewhere (the review page, the CLI) stays live until Set Prompt runs again.
const set = { show: { resource: ['review'], operation: ['set'] } };
const request = { show: { resource: ['review'], operation: ['request'] } };

export const REVIEW_PROPERTIES: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: show,
		options: [
			{
				name: 'Request Review',
				value: 'request',
				action: 'Request a review',
				description: 'Ask the model for an answer under the live prompt, for a person to approve or reject on Reduck',
			},
			{
				name: 'Set Prompt',
				value: 'set',
				action: 'Set a prompt',
				description: 'Make these instructions the live version of the prompt',
			},
		],
		default: 'request',
	},
	{ ...PROMPT, displayOptions: show },
	{
		displayName: 'Instructions',
		name: 'instructions',
		type: 'string',
		typeOptions: { rows: 6 },
		default: '',
		required: true,
		description:
			'What the model must do with each item. A change here becomes the next version of the prompt.',
		displayOptions: set,
	},
	{
		displayName: 'Answer Schema',
		name: 'answer',
		type: 'json',
		default: ANSWER,
		description:
			'The JSON Schema of the answer. The reviewer edits the answer in a form made from it.',
		displayOptions: set,
	},
	{
		displayName: 'Review CSS',
		name: 'css',
		type: 'string',
		typeOptions: { rows: 6 },
		default: '',
		description:
			'The look of the evidence on the review page. Scope it under .rv-evidence. A change here becomes the next version of the prompt.',
		displayOptions: set,
	},
	{
		displayName: 'Input',
		name: 'input',
		type: 'json',
		default: '={{ $json }}',
		description: 'The data the decision holds. The trigger gives it back.',
		displayOptions: request,
	},
	{
		displayName: 'Evidence',
		name: 'evidence',
		type: 'string',
		typeOptions: { rows: 6 },
		default: '',
		description:
			'What the model reads and the reviewer sees: Markdown, with &lt;div&gt;, &lt;span&gt; and other simple tags that take a class. Empty: made from Input, its "title" as the headline.',
		displayOptions: request,
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		options: [
			{
				displayName: 'Auto Accept',
				name: 'accept',
				type: 'boolean',
				default: false,
				description:
					'Whether the workflow accepts the answer itself, so no person reviews it. For a measurement, such as a score or a tier.',
			},
			{
				displayName: 'Reference',
				name: 'ref',
				type: 'string',
				default: '',
				placeholder: 'e.g. https://www.reddit.com/r/n8n/comments/1xsi396/',
				description: 'What the decision is about, such as its URL. The review page links to it.',
			},
			{
				displayName: 'Tries',
				name: 'tries',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 5 },
				default: 1,
				description:
					'For an answer that is free text: how many drafts to make while a check of the draft against the instructions fails',
			},
		],
		displayOptions: request,
	},
];

interface App {
	id: string;
	image: { handle: string; slug: string } | null;
}

// A decision as flock answers it.
interface Decision extends IDataObject {
	id: string;
	ruledAt: string | null;
}

/** The app's door on flock. */
const door = async (ctx: Ctx, app: App) => `${await flockUrl(ctx)}/api/apps/${app.id}/decide`;

/** The account's n8n_app, if it has one. */
export async function findApp(ctx: Ctx): Promise<App | undefined> {
	const path = `/api/apps/${encodeURIComponent(await ownHandle(ctx))}`;
	for (let page = 0; ; page++) {
		const { data, has_next_page } = await reduckRequest<{ data: App[]; has_next_page: boolean }>(
			ctx,
			'GET',
			path,
			{ qs: { page, page_size: 100 } },
		);
		const app = data.find((a) => a.image?.handle === IMAGE.handle && a.image.slug === IMAGE.slug);
		if (app || !has_next_page) return app;
	}
}

// JSON with its keys in order: Postgres gives a stored schema back with its keys moved.
const canonical = (value: unknown): string =>
	JSON.stringify(value, (_key, v: unknown) =>
		v && typeof v === 'object' && !Array.isArray(v)
			? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
			: v,
	);

const json = (ctx: IExecuteFunctions, name: string, i: number): IDataObject => {
	const value = ctx.getNodeParameter(name, i);
	try {
		return (typeof value === 'string' ? JSON.parse(value) : value) as IDataObject;
	} catch {
		throw new NodeOperationError(ctx.getNode(), `${name} is not valid JSON`, { itemIndex: i });
	}
};

interface Version {
	version: string;
	live: boolean;
	template: string;
	output: unknown;
	css: string | null;
}

/** Set Prompt: the item's prompt made or changed only when it differs from the live version. */
export async function setPrompt(ctx: IExecuteFunctions, i: number): Promise<IDataObject> {
	const app =
		(await findApp(ctx)) ??
		(await reduckRequest<App>(ctx, 'POST', `/api/apps/${encodeURIComponent(await ownHandle(ctx))}`, {
			body: { image: IMAGE },
		}));
	const name = ctx.getNodeParameter('prompt', i) as string;
	const template = ctx.getNodeParameter('instructions', i) as string;
	const output = json(ctx, 'answer', i);
	const css = ctx.getNodeParameter('css', i, '') as string;
	const prompts = `${await door(ctx, app)}/prompts`;
	const { prompts: versions } = await reduckRequest<{ prompts: Version[] }>(ctx, 'GET', prompts, {
		qs: { name },
	});
	let live = versions.find((version) => version.live);
	if (
		live?.template !== template ||
		canonical(live.output) !== canonical(output) ||
		(live.css ?? '') !== css
	)
		// Any input is accepted: what each item holds is the workflow's. An empty css clears it, where
		// null would keep the live version's.
		live = await reduckRequest<Version>(ctx, 'POST', prompts, {
			body: { name, template, input: { type: 'object' }, output, css, promote: true },
		});
	return { prompt: name, version: Number(live.version) };
}

/** Request Review's app: Set Prompt makes it, so none means no prompt was ever set. */
export async function requestApp(ctx: IExecuteFunctions): Promise<App> {
	const app = await findApp(ctx);
	if (!app)
		throw new NodeOperationError(ctx.getNode(), 'This Reduck account has no n8n_app', {
			description: 'Run Set Prompt first.',
		});
	return app;
}

// What the reviewer reads: the item's fields as a document, its title first as the headline.
const evidence = ({ title, ...fields }: IDataObject): string =>
	[
		...(title ? [`# ${String(title)}`] : []),
		...Object.entries(fields)
			.filter(([, value]) => value !== null && value !== undefined && value !== '')
			.map(
				([key, value]) =>
					`## ${key}\n\n${typeof value === 'string' ? value : JSON.stringify(value, null, 1)}`,
			),
	].join('\n\n') || '(empty)';

/** A decision as this node gives it, waiting or ruled, with the page that lists its prompt's. */
export const toItem = async (ctx: Ctx, app: App, decision: Decision): Promise<IDataObject> => ({
	id: Number(decision.id),
	ref: decision.ref,
	verdict: decision.verdict,
	output: decision.output,
	feedback: decision.feedback,
	input: decision.input,
	proposed: decision.proposed,
	prompt: decision.prompt,
	version: decision.version,
	ruled_at: decision.ruledAt,
	review_url: `${await flockUrl(ctx)}/app/${app.id}/decisions?prompt=${encodeURIComponent(String(decision.prompt))}`,
});

export async function review(ctx: IExecuteFunctions, app: App, i: number): Promise<IDataObject> {
	const input = json(ctx, 'input', i);
	const { tries = 1, accept = false, ref = '' } = ctx.getNodeParameter('options', i, {}) as {
		tries?: number;
		accept?: boolean;
		ref?: string;
	};
	const decision = await reduckRequest<Decision>(ctx, 'POST', await door(ctx, app), {
		body: {
			prompt: ctx.getNodeParameter('prompt', i),
			input,
			evidence: (ctx.getNodeParameter('evidence', i, '') as string) || evidence(input),
			tries,
			...(ref ? { ref } : {}),
		},
	});
	// The same ruling a person makes on the review page, with the model's own answer.
	return toItem(
		ctx,
		app,
		accept
			? await reduckRequest<Decision>(ctx, 'POST', `${await door(ctx, app)}/${decision.id}`, {
					body: { action: 'accept', output: decision.output },
				})
			: decision,
	);
}

/** The ids of the prompt's decisions that match, oldest first: every page, or with `limit` one. */
export async function decisionIds(ctx: Ctx, app: App, qs: IDataObject): Promise<number[]> {
	const ids: number[] = [];
	for (let cursor: string | null | undefined; cursor !== null; ) {
		const page: { decisions: Decision[]; next: string | null } = await reduckRequest(
			ctx,
			'GET',
			await door(ctx, app),
			{ qs: { sort: 'oldest', limit: 200, ...qs, ...(cursor ? { cursor } : {}) } },
		);
		ids.push(...page.decisions.map((decision) => Number(decision.id)));
		cursor = qs.limit ? null : page.next;
	}
	return ids;
}

export const readDecision = async (ctx: Ctx, app: App, id: number): Promise<Decision> =>
	reduckRequest<Decision>(ctx, 'GET', `${await door(ctx, app)}/${id}`);
