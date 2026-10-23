import type { INodeProperties } from 'n8n-workflow';

export const runOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['run'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get the status and result of a run',
				action: 'Get a run',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List your past runs, newest first',
				action: 'Get many runs',
			},
		],
		default: 'get',
	},
];

export const runFields: INodeProperties[] = [
	{
		displayName: 'Run ID',
		name: 'runId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { resource: ['run'], operation: ['get'] } },
		description: 'The ID returned by Script → Run, or shown in your Reduck run history',
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: { show: { resource: ['run'], operation: ['getAll'] } },
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		displayOptions: { show: { resource: ['run'], operation: ['getAll'], returnAll: [false] } },
		description: 'Max number of results to return',
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['run'], operation: ['getAll'] } },
		options: [
			{
				displayName: 'Host',
				name: 'host',
				type: 'string',
				default: '',
				placeholder: 'e.g. example.com',
				description: 'Only runs of scripts for this website',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{ name: 'Cancelled', value: 'cancelled' },
					{ name: 'Error', value: 'error' },
					{ name: 'Queued', value: 'queued' },
					{ name: 'Running', value: 'running' },
					{ name: 'Success', value: 'success' },
				],
				default: 'success',
			},
		],
	},
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		displayOptions: { show: { resource: ['run'] } },
		description:
			'Whether to return only the run ID, status, script, result and error instead of the full record',
	},
];
