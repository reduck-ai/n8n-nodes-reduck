import {
	NodeConnectionTypes,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type IPollFunctions,
} from 'n8n-workflow';

import { QUEUE, decisionIds, findQueue, ownHandle, readDecision, toItem } from './review';

export class ReduckTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Reduck Trigger',
		name: 'reduckTrigger',
		icon: { light: 'file:reduck.svg', dark: 'file:reduck.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["queue"]}}',
		description: 'Starts the workflow when a person approves or rejects a review on Reduck',
		defaults: { name: 'Reduck Trigger' },
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'reduckApi', required: true }],
		properties: [{ ...QUEUE, description: 'The name of the review queue' }],
	};

	// Each ruling once. Flock lists decisions by id, not by the time of their ruling, so what is
	// kept between polls is the ids that waited and the highest id seen: a decision is ruled since
	// the last poll when it waited then and does not now, or when it is above that id and already
	// ruled. The first poll only records them, so the rulings made before the workflow was
	// activated do not start it.
	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const name = this.getNodeParameter('queue', '') as string;
		const app = await findQueue(this, name, await ownHandle(this));
		if (!app) return null;

		// A test fetch shows the last ruling and moves nothing.
		if (this.getMode() === 'manual') {
			const [id] = await decisionIds(this, app, { rulable: false, sort: 'newest', limit: 1 });
			if (id === undefined) return null;
			return [[{ json: await toItem(this, app, await readDecision(this, app, id)) }]];
		}

		const state = this.getWorkflowStaticData('node') as { waiting?: number[]; last?: number };
		const waiting = await decisionIds(this, app, { rulable: true });
		if (state.waiting === undefined) {
			const [newest = 0] = await decisionIds(this, app, { sort: 'newest', limit: 1 });
			Object.assign(state, { waiting, last: newest });
			return null;
		}
		const ruledSince = [
			...state.waiting.filter((id) => !waiting.includes(id)),
			...(await decisionIds(this, app, { rulable: false, cursor: String(state.last) })),
		];
		const rulings = [];
		for (const id of ruledSince) {
			const decision = await readDecision(this, app, id);
			if (decision.ruledAt) rulings.push(decision);
		}
		// After the reads: a poll that fails keeps what it knew, and the next one finds them again.
		Object.assign(state, { waiting, last: Math.max(state.last ?? 0, ...waiting, ...ruledSince) });
		if (!rulings.length) return null;
		rulings.sort((a, b) => String(a.ruledAt).localeCompare(String(b.ruledAt)));
		return [await Promise.all(rulings.map(async (ruling) => ({ json: await toItem(this, app, ruling) })))];
	}
}
