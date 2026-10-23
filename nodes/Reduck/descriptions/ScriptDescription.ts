import type { INodeProperties } from 'n8n-workflow';

export const scriptOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['script'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get a script, with its inputs and outputs',
				action: 'Get a script',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List your scripts',
				action: 'Get many scripts',
			},
			{
				name: 'Run',
				value: 'run',
				description: 'Run a script in a browser and return its result',
				action: 'Run a script',
			},
		],
		default: 'run',
	},
];

export const scriptFields: INodeProperties[] = [
	{
		displayName: 'Script',
		name: 'script',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		displayOptions: { show: { resource: ['script'], operation: ['get', 'run'] } },
		description: 'The script to use',
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: {
					searchListMethod: 'searchScripts',
					searchable: true,
				},
			},
			{
				displayName: 'By Path',
				name: 'path',
				type: 'string',
				placeholder: 'example.com/get_prices',
				hint: 'Use "host/slug" for your own script, or "owner/host/slug" for a script shared with you',
				validation: [
					{
						type: 'regex',
						properties: {
							regex: '^[^/\\s]+(/[^/\\s]+){1,2}$',
							errorMessage: 'Use "host/slug" or "owner/host/slug"',
						},
					},
				],
			},
		],
	},
	{
		displayName: 'Script Arguments',
		name: 'scriptArguments',
		type: 'json',
		default: '{}',
		displayOptions: { show: { resource: ['script'], operation: ['run'] } },
		description:
			"The script's inputs, as a JSON object shaped by its input schema. Use Get on the script to see them.",
	},
	{
		displayName: 'Wait for Completion',
		name: 'waitForCompletion',
		type: 'boolean',
		default: true,
		displayOptions: { show: { resource: ['script'], operation: ['run'] } },
		description:
			'Whether to wait for the run to finish and return its result. When off, the node returns the run ID right away; read it later with Run → Get.',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['script'], operation: ['run'] } },
		options: [
			{
				displayName: 'Browser',
				name: 'browser',
				type: 'options',
				options: [
					{
						name: 'Hosted by Reduck',
						value: 'managed',
						description: 'A browser that Reduck runs in the cloud',
					},
					{
						name: 'Your Browser Extension',
						value: 'extension',
						description: 'Your Chrome, paired with the Reduck extension',
					},
					{
						name: 'Local Device',
						value: 'local',
						description: 'A machine paired with "reduck local"',
					},
					{
						name: 'Specific Device',
						value: 'device',
						description: 'One paired device, chosen by its ID',
					},
				],
				default: 'managed',
				description: 'Where the script runs',
			},
			{
				displayName: 'Country',
				name: 'country',
				type: 'string',
				default: '',
				placeholder: 'FR',
				description:
					'Two-letter country code to run the hosted browser from that country. Hosted browser only.',
			},
			{
				displayName: 'Device ID',
				name: 'deviceId',
				type: 'string',
				default: '',
				description: 'ID of the paired device to run on, from your Reduck devices page',
			},
			{
				displayName: 'Fail on Script Error',
				name: 'failOnScriptError',
				type: 'boolean',
				default: true,
				description:
					'Whether a run that ends in error stops the workflow. When off, the run is returned with status "error".',
			},
			{
				displayName: 'Max Wait (Seconds)',
				name: 'maxWaitSeconds',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 3600 },
				default: 300,
				description:
					'How long to wait for the run to finish. If it is still running then, the node returns its current status.',
			},
		],
	},
	{
		displayName: 'Owner',
		name: 'owner',
		type: 'string',
		default: '',
		placeholder: '@jane',
		displayOptions: { show: { resource: ['script'], operation: ['getAll'] } },
		description:
			'Whose scripts to list: a user ("@jane") or a project handle. Leave empty for your own scripts.',
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: { show: { resource: ['script'], operation: ['getAll'] } },
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		displayOptions: { show: { resource: ['script'], operation: ['getAll'], returnAll: [false] } },
		description: 'Max number of results to return',
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['script'], operation: ['getAll'] } },
		options: [
			{
				displayName: 'Host',
				name: 'host',
				type: 'string',
				default: '',
				placeholder: 'example.com',
				description: 'Only scripts for this website',
			},
			{
				displayName: 'Include Archived',
				name: 'includeArchived',
				type: 'boolean',
				default: false,
				description: 'Whether to also return archived scripts',
			},
			{
				displayName: 'Search',
				name: 'search',
				type: 'string',
				default: '',
				description: 'Words to look for in the name, description and inputs',
			},
			{
				displayName: 'Visibility',
				name: 'visibility',
				type: 'options',
				options: [
					{ name: 'Private', value: 'private' },
					{ name: 'Public', value: 'public' },
				],
				default: 'private',
			},
		],
	},
];
