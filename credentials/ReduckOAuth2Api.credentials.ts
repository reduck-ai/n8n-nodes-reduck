import type { Icon, ICredentialType, INodeProperties } from 'n8n-workflow';

// Reduck publishes its OAuth metadata (RFC 9728, then RFC 8414) and lets a client register itself
// (RFC 7591). With dynamic client registration on, n8n reads both from the server URL, registers,
// and signs in with PKCE, so the user only presses "Connect".
export class ReduckOAuth2Api implements ICredentialType {
	name = 'reduckOAuth2Api';

	extends = ['oAuth2Api'];

	displayName = 'Reduck OAuth2 API';

	icon: Icon = {
		light: 'file:../nodes/Reduck/reduck.svg',
		dark: 'file:../nodes/Reduck/reduck.dark.svg',
	};

	documentationUrl = 'https://github.com/reduck-ai/n8n-nodes-reduck#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Use Dynamic Client Registration',
			name: 'useDynamicClientRegistration',
			type: 'hidden',
			default: true,
		},
		{
			displayName: 'Server URL',
			name: 'serverUrl',
			type: 'hidden',
			default: 'https://reduck.ai',
		},
	];
}
