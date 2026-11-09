import {
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type ILoadOptionsFunctions,
	type INodeListSearchResult,
	type INodeProperties,
	type INodePropertyOptions,
	type IPollFunctions,
} from 'n8n-workflow';

import { reduckRequest, reduckUrl } from './transport';

// A review queue is a Reduck app with no page: its prompts, and the decisions the model makes under
// them for a person to approve or reject on Reduck. Its address is "<owner handle>/<app id>".

const show = (operation: string[]) => ({ show: { resource: ['review'], operation } });

export const QUEUE: INodeProperties = {
	displayName: 'Queue',
	name: 'queue',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			placeholder: 'Select a queue...',
			typeOptions: { searchListMethod: 'searchQueues', searchable: true },
		},
		{
			displayName: 'By Address',
			name: 'address',
			type: 'string',
			placeholder: 'e.g. @you/6f1c…',
			validation: [
				{
					type: 'regex',
					properties: { regex: '^[^/\\s]+/[0-9a-f-]{36}$', errorMessage: 'Use the form handle/id' },
				},
			],
		},
	],
};

const ANSWER = JSON.stringify(
	{ type: 'object', required: ['reply'], properties: { reply: { type: 'string' } } },
	null,
	2,
);

export const REVIEW_PROPERTIES: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['review'] } },
		options: [
			{
				name: 'Create Queue',
				value: 'create',
				action: 'Create a review queue',
				description: 'Create a queue and its first prompt',
			},
			{
				name: 'Request Review',
				value: 'request',
				action: 'Request a review',
				description: 'Ask the model for an answer, for a person to approve or reject on Reduck',
			},
			{
				name: 'Update Prompt',
				value: 'updatePrompt',
				action: 'Update a prompt',
				description: 'Make a new version of a prompt live. The earlier versions are kept.',
			},
		],
		default: 'request',
	},
	{
		displayName: 'Owner Name or ID',
		name: 'owner',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getOwners' },
		default: '',
		required: true,
		description:
			'Who owns the queue: you, or a project whose members can then review. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: show(['create']),
	},
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		default: '',
		required: true,
		displayOptions: show(['create']),
	},
	{ ...QUEUE, displayOptions: show(['request', 'updatePrompt']) },
	{
		displayName: 'Prompt',
		name: 'prompt',
		type: 'string',
		default: 'reply',
		required: true,
		description: 'The name of the prompt. A request uses its live version.',
		displayOptions: { show: { resource: ['review'] } },
	},
	{
		displayName: 'Instructions',
		name: 'instructions',
		type: 'string',
		typeOptions: { rows: 6 },
		default: '',
		required: true,
		description: 'What the model must do with each item',
		displayOptions: show(['create', 'updatePrompt']),
	},
	{
		displayName: 'Answer Schema',
		name: 'answer',
		type: 'json',
		default: ANSWER,
		description:
			'The JSON Schema of the answer. The reviewer edits the answer in a form made from it.',
		displayOptions: show(['create', 'updatePrompt']),
	},
	{
		displayName: 'Input',
		name: 'input',
		type: 'json',
		default: '={{ $json }}',
		description: 'What the model judges, and what the reviewer reads',
		displayOptions: show(['request']),
	},
	{
		displayName: 'Reference',
		name: 'reference',
		type: 'string',
		default: '',
		placeholder: 'e.g. {{ $json.url }}',
		description: 'Your own key for this item. The trigger gives it back with the ruling.',
		displayOptions: show(['request']),
	},
	{
		displayName: 'Tries',
		name: 'tries',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 5 },
		default: 1,
		description:
			'For an answer that is free text: how many drafts to make while a check of the draft against the instructions fails',
		displayOptions: show(['request']),
	},
];

// The queue's API path, from its "<handle>/<id>" address.
export const queuePath = (address: string): string => {
	const [handle, id] = address.split('/');
	return `/api/apps/${encodeURIComponent(handle)}/${id}`;
};

// Where a person reviews the queue's decisions.
export const reviewUrl = async (
	ctx: IExecuteFunctions | IPollFunctions,
	address: string,
): Promise<string> =>
	`${await reduckUrl(ctx)}/projects/${address.replace('/', '/apps/')}/decisions`;

interface App {
	id: string;
	name: string;
	owner: { handle: string };
}

export async function searchQueues(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const { data } = await reduckRequest<{ data: App[] }>(this, 'GET', '/api/apps', {
		qs: { page_size: 100 },
	});
	return {
		results: data
			.filter((app) => !filter || app.name.toLowerCase().includes(filter.toLowerCase()))
			.map((app) => ({
				name: `${app.name} (${app.owner.handle})`,
				value: `${app.owner.handle}/${app.id}`,
			})),
	};
}

// The account itself, then its projects.
export async function getOwners(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const me = await reduckRequest<{
		handle: string | null;
		projects: Array<{ handle: string; name: string }>;
	}>(this, 'GET', '/api/me');
	return [
		...(me.handle ? [{ name: `You (${me.handle})`, value: me.handle }] : []),
		...me.projects.map((project) => ({
			name: `${project.name} (${project.handle})`,
			value: project.handle,
		})),
	];
}

const json = (ctx: IExecuteFunctions, name: string, i: number): IDataObject => {
	const value = ctx.getNodeParameter(name, i);
	try {
		return (typeof value === 'string' ? JSON.parse(value) : value) as IDataObject;
	} catch {
		throw new NodeOperationError(ctx.getNode(), `${name} is not valid JSON`, { itemIndex: i });
	}
};

// A live version of the prompt. Any input is accepted: what each item holds is the workflow's.
const promptVersion = (ctx: IExecuteFunctions, i: number): IDataObject => ({
	name: ctx.getNodeParameter('prompt', i) as string,
	template: ctx.getNodeParameter('instructions', i) as string,
	input: { type: 'object' },
	output: json(ctx, 'answer', i),
	promote: true,
});

export async function review(ctx: IExecuteFunctions, i: number): Promise<IDataObject> {
	const operation = ctx.getNodeParameter('operation', i) as string;

	if (operation === 'create') {
		const app = await reduckRequest<App>(
			ctx,
			'POST',
			`/api/apps/${encodeURIComponent(ctx.getNodeParameter('owner', i) as string)}`,
			{ body: { name: ctx.getNodeParameter('name', i) as string } },
		);
		const queue = `${app.owner.handle}/${app.id}`;
		const prompt = await reduckRequest<IDataObject>(ctx, 'POST', `${queuePath(queue)}/prompts`, {
			body: promptVersion(ctx, i),
		});
		return { queue, name: app.name, prompt, review_url: await reviewUrl(ctx, queue) };
	}

	const queue = ctx.getNodeParameter('queue', i, '', { extractValue: true }) as string;
	if (operation === 'updatePrompt')
		return reduckRequest<IDataObject>(ctx, 'POST', `${queuePath(queue)}/prompts`, {
			body: promptVersion(ctx, i),
		});

	const reference = ctx.getNodeParameter('reference', i, '') as string;
	const decision = await reduckRequest<IDataObject>(ctx, 'POST', `${queuePath(queue)}/decisions`, {
		body: {
			prompt: ctx.getNodeParameter('prompt', i) as string,
			input: json(ctx, 'input', i),
			tries: ctx.getNodeParameter('tries', i, 1) as number,
			...(reference ? { ref: reference } : {}),
		},
	});
	return { ...decision, queue, review_url: await reviewUrl(ctx, queue) };
}
