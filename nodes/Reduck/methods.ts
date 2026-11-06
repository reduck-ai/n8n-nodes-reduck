import {
	NodeApiError,
	type FieldType,
	type IExecuteFunctions,
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

// The parts of GET /api/devices this package reads.
interface Device {
	id: string;
	name: string | null;
	kind?: string;
	online?: boolean;
	last_seen_at?: string | null;
}

// The account's paired browsers (the extension), most likely in use first: online, then the one
// seen last.
const pairedBrowsers = (devices: Device[]) =>
	devices
		.filter((device) => !device.kind || device.kind === PAIRED_BROWSER)
		.sort(
			(a, b) =>
				Number(!!b.online) - Number(!!a.online) ||
				(b.last_seen_at ?? '').localeCompare(a.last_seen_at ?? ''),
		);

// What Default runs on. With one paired browser or none, the API picks or says why it cannot
// (null). With several, the API refuses to guess, so Default names the one most likely in use.
// Read once per execution.
const defaultDevices = new WeakMap<IExecuteFunctions, Promise<string | null>>();
export function defaultDevice(ctx: IExecuteFunctions): Promise<string | null> {
	if (!defaultDevices.has(ctx))
		defaultDevices.set(
			ctx,
			reduckRequest<Device[]>(ctx, 'GET', '/api/devices').then((devices) => {
				const browsers = pairedBrowsers(devices);
				return browsers.length > 1 ? browsers[0].id : null;
			}),
		);
	return defaultDevices.get(ctx)!;
}

// The paired browsers a run can use: Default, or one of them by name. Browsers often share a name
// ("Google Chrome — macOS"), so a shared name gets the start of the id and when it was last seen.
export async function getDevices(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const browsers = pairedBrowsers(await reduckRequest<Device[]>(this, 'GET', '/api/devices'));
	const named = (device: Device) => device.name ?? device.id;
	const shared = (device: Device) => browsers.filter((other) => named(other) === named(device)).length > 1;
	return [
		{
			name: 'Default',
			value: PAIRED_BROWSER,
			description: 'Your paired browser. With several, the one online or seen most recently.',
		},
		...browsers.map((device) => ({
			name: shared(device) ? `${named(device)} (${device.id.slice(0, 8)})` : named(device),
			value: device.id,
			...(device.last_seen_at
				? { description: `${device.online ? 'Online' : 'Last seen'} ${device.last_seen_at.slice(0, 16).replace('T', ' ')} UTC` }
				: {}),
		})),
	];
}
