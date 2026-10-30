import {
	NodeApiError,
	type FieldType,
	type ILoadOptionsFunctions,
	type INodeListSearchResult,
	type INodePropertyOptions,
	type ResourceMapperField,
	type ResourceMapperFields,
} from 'n8n-workflow';

import { parseScriptAddress, reduckRequest, reduckUrl } from './transport';

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

interface Script {
	current_version: {
		input_schema: { properties?: Record<string, JsonSchemaProperty>; required?: string[] };
	} | null;
}

const PAGE_SIZE = 50;

// The scripts the account can run: its own, its projects', and the official catalogue. Each one
// links to its page on Reduck, which shows its description, its input and its output: n8n shows
// none of them in a node (a list item's `description` is not rendered either), so the node points
// at the page that already has them.
export async function searchScripts(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	// The API counts pages from 0.
	const page = paginationToken ? Number(paginationToken) : 0;
	const origin = await reduckUrl(this);
	const answer = await reduckRequest<{ data: ScriptSummary[]; has_next_page: boolean }>(this, 'GET', '/api/scripts', {
		qs: { page, page_size: PAGE_SIZE, ...(filter ? { q: filter } : {}) },
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
	const script = parseScriptAddress(typeof address === 'string' ? address : '');
	if (!script) return { fields: [] };

	const answer = await reduckRequest<Script>(this,
		'GET',
		`/api/scripts/${encodeURIComponent(script.handle)}/${encodeURIComponent(script.host)}/${encodeURIComponent(script.slug)}`,
	).catch((error: unknown) => {
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

// The API's own name for the account's paired browser, sent as the run's `browser`: the API picks
// it, and refuses by name when there is none or several, listing them.
export const PAIRED_BROWSER = 'extension';

// Where a run can happen: the account's paired browser, one of them by name, or a Reduck managed
// browser.
export async function getDevices(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const devices = await reduckRequest<Array<{ id: string; name: string | null }>>(this, 'GET', '/api/devices');
	return [
		{ name: 'My Paired Browser', value: PAIRED_BROWSER },
		{ name: 'Reduck Managed Browser', value: '' },
		...devices.map((device) => ({ name: device.name ?? device.id, value: device.id })),
	];
}
