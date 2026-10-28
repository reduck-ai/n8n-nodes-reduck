import type {
	FieldType,
	ILoadOptionsFunctions,
	INodeListSearchResult,
	INodePropertyOptions,
	ResourceMapperField,
	ResourceMapperFields,
} from 'n8n-workflow';

import { parseScriptAddress, reduckRequest } from './transport';

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

interface Script {
	current_version: {
		input_schema: { properties?: Record<string, JsonSchemaProperty>; required?: string[] };
	} | null;
}

const PAGE_SIZE = 50;

// The scripts the account can run: its own, its projects', and the official catalogue.
export async function searchScripts(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	// The API counts pages from 0.
	const page = paginationToken ? Number(paginationToken) : 0;
	const answer = await reduckRequest<{ data: ScriptSummary[]; has_next_page: boolean }>(this, 'GET', '/api/scripts', {
		qs: { page, page_size: PAGE_SIZE, ...(filter ? { q: filter } : {}) },
	});
	return {
		results: answer.data.map((script) => ({
			name: `${script.name} (${script.author.handle}/${script.host}/${script.slug})`,
			value: `${script.author.handle}/${script.host}/${script.slug}`,
		})),
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

// One field per argument in the script's input schema. A file input is left out: this node does
// not send files yet.
export async function getScriptArgs(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
	const address = this.getCurrentNodeParameter('script', { extractValue: true });
	const script = parseScriptAddress(typeof address === 'string' ? address : '');
	if (!script) return { fields: [] };

	const answer = await reduckRequest<Script>(this,
		'GET',
		`/api/scripts/${encodeURIComponent(script.handle)}/${encodeURIComponent(script.host)}/${encodeURIComponent(script.slug)}`,
	);
	const schema = answer.current_version?.input_schema ?? {};
	const required = new Set(schema.required ?? []);

	const fields: ResourceMapperField[] = Object.entries(schema.properties ?? {})
		.filter(([, property]) => property.format !== 'file')
		.map(([name, property]) => ({
			id: name,
			displayName: name,
			required: required.has(name),
			defaultMatch: false,
			display: true,
			type: fieldType(property),
			...(property.enum
				? { options: property.enum.map((value) => ({ name: String(value), value: String(value) })) }
				: {}),
		}));
	return { fields };
}

// Where a run can happen: a Reduck managed browser, or one of the account's paired browsers.
export async function getDevices(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const devices = await reduckRequest<Array<{ id: string; name: string | null }>>(this, 'GET', '/api/devices');
	return [
		{ name: 'Reduck Managed Browser', value: '' },
		...devices.map((device) => ({ name: device.name ?? device.id, value: device.id })),
	];
}
