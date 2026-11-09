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

	documentationUrl = 'https://docs.reduck.ai/n8n/#credentials';

	// n8n's allowlist for this credential in the HTTP Request node. The Reduck node only calls the
	// credential's own Reduck URL, which the list never blocks, so the field would only add noise.
	hideDomainRestrictionFields = true;

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			// Shown under the field; a description shows only in its tooltip.
			hint: 'Get your API key at <a href="https://reduck.ai/api-keys?utm_source=n8n&utm_medium=credential" target="_blank">reduck.ai/api-keys</a>',
		},
		// Another Reduck environment, for our tests, is set where the credential is imported, with
		// the Vercel protection bypass that staging asks for.
		{
			displayName: 'Reduck URL',
			name: 'url',
			type: 'hidden',
			default: 'https://reduck.ai',
		},
		{
			displayName: 'Protection Bypass',
			name: 'bypass',
			type: 'hidden',
			default: '',
		},
	];

	// The bypass header only when one is set, so a request to production is the same without it.
	authenticate: IAuthenticate = async (credentials, requestOptions) => ({
		...requestOptions,
		headers: {
			...requestOptions.headers,
			'X-API-Key': credentials.apiKey as string,
			...(credentials.bypass ? { 'x-vercel-protection-bypass': credentials.bypass as string } : {}),
		},
	});

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.url.replace(/\\/+$/, "")}}',
			url: '/api/me',
		},
	};
}
