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
	description: 'The name of the prompt in your n8n_app. Request Review creates it when it does not exist.',
};

const ANSWER = JSON.stringify(
	{ type: 'object', required: ['reply'], properties: { reply: { type: 'string' } } },
	null,
	2,
);

const show = { show: { resource: ['review'] } };

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
				description: 'Ask the model for an answer, for a person to approve or reject on Reduck',
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
		displayOptions: show,
	},
	{
		displayName: 'Answer Schema',
		name: 'answer',
		type: 'json',
		default: ANSWER,
		description:
			'The JSON Schema of the answer. The reviewer edits the answer in a form made from it.',
		displayOptions: show,
	},
	{
		displayName: 'Input',
		name: 'input',
		type: 'json',
		default: '={{ $json }}',
		description: 'What the model judges, and what the reviewer reads. A "title" is its headline.',
		displayOptions: show,
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		options: [
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
		displayOptions: show,
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

/**
 * The app, and its prompt as the first item states it, made or changed only when they differ: every
 * item of an execution is judged under the same version.
 */
export async function prepare(ctx: IExecuteFunctions): Promise<App> {
	const app =
		(await findApp(ctx)) ??
		(await reduckRequest<App>(ctx, 'POST', `/api/apps/${encodeURIComponent(await ownHandle(ctx))}`, {
			body: { image: IMAGE },
		}));
	const name = ctx.getNodeParameter('prompt', 0) as string;
	const template = ctx.getNodeParameter('instructions', 0) as string;
	const output = json(ctx, 'answer', 0);
	const prompts = `${await door(ctx, app)}/prompts`;
	const { prompts: versions } = await reduckRequest<{
		prompts: Array<{ live: boolean; template: string; output: unknown }>;
	}>(ctx, 'GET', prompts, { qs: { name } });
	const live = versions.find((version) => version.live);
	if (live?.template !== template || canonical(live.output) !== canonical(output))
		// Any input is accepted: what each item holds is the workflow's.
		await reduckRequest(ctx, 'POST', prompts, {
			body: { name, template, input: { type: 'object' }, output, promote: true },
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
	const { tries = 1 } = ctx.getNodeParameter('options', i, {}) as { tries?: number };
	const decision = await reduckRequest<Decision>(ctx, 'POST', await door(ctx, app), {
		body: {
			prompt: ctx.getNodeParameter('prompt', 0),
			input,
			evidence: evidence(input),
			explain: 'text',
			tries,
		},
	});
	return toItem(ctx, app, decision);
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
