import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class ReduckApi implements ICredentialType {
	name = 'reduckApi';

	displayName = 'Reduck API';

	icon: Icon = { light: 'file:../nodes/Reduck/reduck.svg', dark: 'file:../nodes/Reduck/reduck.dark.svg' };

	documentationUrl = 'https://github.com/reduck-ai/n8n-nodes-reduck#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'Create one in the Reduck dashboard, under <a href="https://reduck.ai/api-keys" target="_blank">API keys</a>',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://staging.reduck.ai',
			description: 'Change it only to use another Reduck environment',
		},
		{
			displayName: 'Vercel Protection Bypass Token',
			name: 'vercelBypassToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'Only for a Reduck environment behind Vercel deployment protection, such as staging',
		},
	];

	// Every request of the node, and the credential test, go through these headers.
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-API-Key': '={{$credentials.apiKey}}',
				'x-vercel-protection-bypass': '={{$credentials.vercelBypassToken}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/api/me',
		},
	};
}
