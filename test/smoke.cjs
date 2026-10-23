// Runs the built Reduck node outside n8n with a minimal IExecuteFunctions.
// Auth: REDUCK_API_KEY. Usage: REDUCK_API_KEY=... node test/smoke.cjs <package dir> <params JSON>
if (!process.env.REDUCK_API_KEY) { console.error('Set REDUCK_API_KEY'); process.exit(1); }
const path = require('path').resolve(process.argv[2]);
const params = JSON.parse(process.argv[3]);
const { Reduck } = require(path + '/dist/nodes/Reduck/Reduck.node.js');
const auth = { 'X-API-Key': process.env.REDUCK_API_KEY };
async function httpRequest(o) {
  const url = new URL(o.url);
  for (const [k, v] of Object.entries(o.qs || {})) if (v !== undefined) url.searchParams.set(k, String(v));
  const headers = { ...(o.headers || {}), ...auth };
  // Like n8n: a JSON request with an object body is sent as application/json.
  if (o.json && o.body !== undefined && typeof o.body !== 'string') headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method: o.method, headers, body: o.body === undefined ? undefined : (typeof o.body === 'string' ? o.body : JSON.stringify(o.body)), signal: AbortSignal.timeout(o.timeout || 60000) });
  const text = await res.text();
  if (!res.ok && !o.ignoreHttpStatusErrors) { const e = new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`); e.httpCode = String(res.status); e.response = { status: res.status, headers: Object.fromEntries(res.headers) }; throw e; }
  const body = o.json ? (text ? JSON.parse(text) : {}) : text;
  if (o.returnFullResponse) return { body, headers: Object.fromEntries(res.headers), statusCode: res.status };
  return body;
}
const node = { name: 'Reduck', type: 'n8n-nodes-reduck.reduck', typeVersion: 1, parameters: params };
const ctx = {
  getInputData: () => Array.from({ length: Number(process.env.SMOKE_ITEMS || 1) }, () => ({ json: {} })),
  getNode: () => node,
  continueOnFail: () => process.env.SMOKE_CONTINUE === '1',
  getNodeParameter: (name, i, fallback, opts) => {
    let v = name in params ? params[name] : fallback;
    if (opts && opts.extractValue && v && typeof v === 'object') v = v.value;
    return v;
  },
  helpers: { httpRequestWithAuthentication: (cred, o) => httpRequest(o) },
};
(async () => {
  const t = Date.now();
  try {
    const out = await new Reduck().execute.call(ctx);
    const items = out[0].map((x) => x.json);
    console.log('items:', items.length);
    console.log(JSON.stringify(items, null, 1).slice(0, Number(process.env.SMOKE_CHARS || 2500)));
  } catch (e) { console.log('ERROR', e.constructor.name, e.message, e.description || ''); }
  console.log('took', Date.now() - t, 'ms');
})();
