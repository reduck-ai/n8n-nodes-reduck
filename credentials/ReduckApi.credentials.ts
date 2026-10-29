import type {
	IAuthenticate,
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
			displayName: 'Reduck URL',
			name: 'url',
			type: 'string',
			default: 'https://reduck.ai',
			description: 'Change it only to test against another Reduck environment',
		},
		{
			displayName: 'Deployment Protection Bypass',
			name: 'bypassToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'Only for a Reduck test environment behind deployment protection. Leave it empty.',
		},
	];

	// A function rather than a generic header map: the bypass header goes out only when it is set,
	// never as an empty value to production.
	authenticate: IAuthenticate = async (credentials, requestOptions) => ({
		...requestOptions,
		headers: {
			...requestOptions.headers,
			'X-API-Key': credentials.apiKey as string,
			...(credentials.bypassToken
				? { 'x-vercel-protection-bypass': credentials.bypassToken as string }
				: {}),
		},
	});

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.url.replace(/\\/+$/, "")}}',
			url: '/api/me',
		},
	};
}
