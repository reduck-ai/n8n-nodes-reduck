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
			description: 'An API key created in your Reduck account on reduck.ai',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-API-Key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://reduck.ai',
			url: '/api/me',
			method: 'GET',
		},
	};
}
