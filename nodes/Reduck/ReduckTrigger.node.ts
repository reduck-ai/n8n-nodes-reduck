import {
	NodeConnectionTypes,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type IPollFunctions,
} from 'n8n-workflow';

import { QUEUE, queuePath, reviewUrl, searchQueues } from './review';
import { reduckRequest } from './transport';

interface Ruling {
	ruled_at: string;
	[key: string]: unknown;
}

export class ReduckTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Reduck Trigger',
		name: 'reduckTrigger',
		icon: { light: 'file:reduck.svg', dark: 'file:reduck.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["prompt"] || "Every prompt"}}',
		description: 'Starts the workflow when a person approves or rejects a review on Reduck',
		defaults: { name: 'Reduck Trigger' },
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'reduckApi', required: true }],
		properties: [
			QUEUE,
			{
				displayName: 'Prompt',
				name: 'prompt',
				type: 'string',
				default: '',
				description: 'Only the reviews of this prompt. Empty: the reviews of every prompt.',
			},
		],
	};

	methods = { listSearch: { searchQueues } };

	// Each ruling once, in the order they were made: the cursor is the `ruled_at` of the last one
	// read, kept between polls, so nothing is lost while the workflow is off. The first poll only
	// sets it, so the rulings made before the workflow was activated do not start it.
	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const queue = this.getNodeParameter('queue', '', { extractValue: true }) as string;
		const prompt = this.getNodeParameter('prompt', '') as string;
		const state = this.getWorkflowStaticData('node') as { ruledAfter?: string };
		const manual = this.getMode() === 'manual';
		if (!manual && !state.ruledAfter) {
			state.ruledAfter = new Date().toISOString();
			return null;
		}

		const { decisions } = await reduckRequest<{ decisions: Ruling[] }>(
			this,
			'GET',
			`${queuePath(queue)}/decisions`,
			{
				qs: {
					ruled_after: manual ? new Date(0).toISOString() : state.ruledAfter,
					limit: 200,
					...(prompt ? { prompt } : {}),
				},
			},
		);
		if (!decisions.length) return null;
		// A test fetch shows one ruling and moves nothing.
		if (!manual) state.ruledAfter = decisions[decisions.length - 1].ruled_at;
		const url = await reviewUrl(this, queue);
		return [
			(manual ? decisions.slice(-1) : decisions).map((ruling) => ({
				json: { ...ruling, queue, review_url: url },
			})),
		];
	}
}
