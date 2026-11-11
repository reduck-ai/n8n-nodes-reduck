import {
	NodeApiError,
	type FieldType,
	type ILoadOptionsFunctions,
	type INodeListSearchResult,
	type INodePropertyOptions,
	type ResourceMapperField,
	type ResourceMapperFields,
} from 'n8n-workflow';

import { parseScriptAddress, reduckRequest, reduckUrl, scriptPath } from './transport';

// A file input's field is keyed apart from the arguments: its value names a binary property of
// the input item, which the node sends as the file's bytes.
export const FILE_FIELD = 'file:';

interface ScriptSummary {
	name: string;
	host: string;
	slug: string;
	author: { handle: string };
}

interface JsonSchemaProperty {
	type?: string | string[];
	enum?: unknown[];
	format?: string;
	description?: string;
}

export interface Script {
	current_version: {
		input_schema: { properties?: Record<string, JsonSchemaProperty>; required?: string[] };
		logged_in?: boolean;
		side_effects?: 'none' | 'undetermined' | 'write';
	} | null;
}

const PAGE_SIZE = 50;

// The scripts of the Handle field's owner, or with no handle every script the account can run: its
// own, its projects', and the official catalogue, as the MCP's list_scripts. Each one links to its
// page on Reduck, which shows its description, its input and its output: n8n shows none of them in
// a node (a list item's `description` is not rendered either), so the node points at the page that
// already has them.
export async function searchScripts(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	// The API counts pages from 0.
	const page = paginationToken ? Number(paginationToken) : 0;
	const origin = await reduckUrl(this);
	const handle = this.getCurrentNodeParameter('handle');
	const path = typeof handle === 'string' && handle ? `/api/scripts/${encodeURIComponent(handle)}` : '/api/scripts';
	const answer = await reduckRequest<{ data: ScriptSummary[]; has_next_page: boolean }>(this, 'GET', path, {
		qs: { page, page_size: PAGE_SIZE, archived: 'false', ...(filter ? { q: filter } : {}) },
	});
	return {
		results: answer.data.map((script) => {
			const address = `${script.author.handle}/${script.host}/${script.slug}`;
			return {
				name: `${script.name} (${address})`,
				value: address,
				url: `${origin}/explore/scripts/${address}`,
			};
		}),
		paginationToken: answer.has_next_page ? String(page + 1) : undefined,
	};
}

// JSON Schema types the resource mapper can show as a field. Anything else is a plain string.
const FIELD_TYPES: Record<string, FieldType> = {
	string: 'string',
	number: 'number',
	integer: 'number',
	boolean: 'boolean',
	array: 'array',
	object: 'object',
};

const fieldType = (property: JsonSchemaProperty): FieldType => {
	if (property.enum) return 'options';
	const type = Array.isArray(property.type)
		? property.type.find((t) => t !== 'null')
		: property.type;
	return (type ? FIELD_TYPES[type] : undefined) ?? 'string';
};

// One field per argument in the script's input schema. A file input is a field too, which names
// the binary property of the input item that holds the file.
export async function getScriptArgs(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
	const address = this.getCurrentNodeParameter('script', { extractValue: true });
	const handle = this.getCurrentNodeParameter('handle');
	const script = await parseScriptAddress(
		this,
		typeof address === 'string' ? address : '',
		typeof handle === 'string' ? handle : '',
	);
	if (!script) return { fields: [] };

	const answer = await reduckRequest<Script>(this, 'GET', scriptPath(script)).catch((error: unknown) => {
		// A thrown error here only hides the form, so a missing script is said where its form would be.
		if (error instanceof NodeApiError && error.httpCode === '404') return null;
		throw error;
	});
	if (!answer) {
		return {
			fields: [],
			emptyFieldsNotice: `No script at "${script.handle}/${script.host}/${script.slug}" for this account. Pick one from the list, or check the address.`,
		};
	}
	const schema = answer.current_version?.input_schema ?? {};
	const required = new Set(schema.required ?? []);

	const fields: ResourceMapperField[] = Object.entries(schema.properties ?? {}).map(([name, property]) => {
		const field = { required: required.has(name), defaultMatch: false, display: true };
		if (property.format === 'file') {
			return { ...field, id: `${FILE_FIELD}${name}`, displayName: `${name} (binary property)`, type: 'string' };
		}
		return {
			...field,
			id: name,
			displayName: name,
			type: fieldType(property),
			...(property.enum
				? { options: property.enum.map((value) => ({ name: String(value), value: String(value) })) }
				: {}),
		};
	});
	return { fields };
}

// The owners a script can come from, as the MCP's `handle`: none for all of them, the official
// catalogue, the account, and its projects.
export async function getHandles(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const me = await reduckRequest<{ handle: string | null; projects: Array<{ handle: string; name: string }> }>(
		this,
		'GET',
		'/api/me',
	);
	return [
		{
			name: 'Any',
			value: '',
			description: "Yours, your projects' and the official scripts. A host/slug address is one of yours.",
		},
		{ name: 'Official', value: 'reduck', description: 'The official catalogue, reduck' },
		...(me.handle ? [{ name: `You (${me.handle})`, value: me.handle }] : []),
		...me.projects
			.filter((project) => project.handle !== 'reduck')
			.map((project) => ({ name: `${project.name} (${project.handle})`, value: project.handle })),
	];
}

// The API's own name for the account's paired browser, sent as the run's `browser`: the API picks
// it, and refuses by name when there is none or several, listing them.
export const PAIRED_BROWSER = 'extension';

// The paired browsers a run can use: the API's own pick, or one of them by name.
export async function getDevices(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const devices = await reduckRequest<Array<{ id: string; name: string | null }>>(this, 'GET', '/api/devices');
	return [
		{
			name: 'Default',
			value: PAIRED_BROWSER,
			description: 'Your only paired browser. When you have more than one, choose one by name.',
		},
		...devices.map((device) => ({ name: device.name ?? device.id, value: device.id })),
	];
}
