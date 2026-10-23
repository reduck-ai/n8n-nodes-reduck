# n8n-nodes-reduck

This is an n8n community node for [Reduck](https://reduck.ai). It lets your workflows run the browser scripts you saved in Reduck and use their results.

A Reduck script does one task on one website: check that a page of your site loads, export a report from your back office, fill in a form in an internal tool. Scripts run on sites and tools you own or are authorized to use. You build and test scripts with the Reduck CLI or an AI coding assistant, then run them from n8n on a schedule, from a webhook, or as a tool of an AI Agent.

[Installation](#installation) · [Prerequisites](#prerequisites) · [Operations](#operations) · [Credentials](#credentials) · [Usage](#usage) · [Example workflow](#example-workflow) · [Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation, and install `n8n-nodes-reduck`.

## Prerequisites

- A Reduck account ([reduck.ai](https://reduck.ai)) with at least one script you built and promoted, for example with the Reduck CLI or an AI coding assistant connected to Reduck.
- A browser for the scripts to run in: either your Chrome paired with the Reduck extension, or the browser hosted by Reduck if it is enabled on your plan.

## Operations

**Script**

- **Run**: run a script in a browser and return its result. By default the node waits for the run to finish (up to 5 minutes, configurable). Turn off *Wait for Completion* to get the run ID right away.
- **Get**: get a script, with its description and its input and output schemas.
- **Get Many**: list your scripts, or the scripts of a project, filtered by website or search words.

**Run**

- **Get**: get the status and result of a run, for example one started without waiting.
- **Get Many**: list your past runs, filtered by status or website.

## Credentials

You need a Reduck account and an API key.

1. Sign in at [reduck.ai](https://reduck.ai) and create an API key in your account.
2. In n8n, create a **Reduck API** credential and paste the key.

n8n checks the key when you save the credential.

## Usage

**Choosing a script.** In *Script*, pick one of your scripts from the list, or switch to *By Path* and type `host/slug` (for example `example.com/export_orders`). For a script shared with you by your team (a project), type `project/host/slug`.

**Arguments.** *Script Arguments* takes a JSON object shaped by the script's input schema. Use *Script → Get* to see which inputs a script takes. To build them from the incoming item, switch the field to *Expression*, for example `{{ JSON.stringify({ url: $json.url }) }}`.

**Where the script runs** (*Browser*):

- *Default*: Reduck picks your paired browser.
- *Hosted by Reduck*: a cloud browser, nothing to install, if it is enabled on your plan. Add *Country* to see your site as visitors from that country do (language, prices, legal banners).
- *Your Browser Extension*: your own Chrome, paired with the Reduck extension.
- *Local Device*: a machine paired with `reduck local`.
- *Specific Device*: one paired device, by its ID (*Device ID*).

**Retries.** Leave the node's *Retry On Fail* setting off for scripts that change something on a website: a retry starts the script again.

**Simplify.** *Script → Get*, *Script → Get Many* and both *Run* operations return a short version of each record by default. Turn off *Simplify* for the full API response.

**Output.** *Script → Run* returns one item:

```json
{
  "runId": "00000000-0000-4000-8000-000000000000",
  "status": "success",
  "script": "@jane/example.com/export_orders",
  "result": { "...": "what the script returned" },
  "error": null,
  "startedAt": "2026-10-23T16:05:45.166Z",
  "finishedAt": "2026-10-23T16:05:46.790Z"
}
```

`status` is `success`, `error`, `cancelled`, or `queued` / `running` for a run you did not wait for. A run that fails, is cancelled, or is still going when *Max Wait* ends stops the workflow, unless you turn off *Options → Fail on Script Error* (the item is then returned with its status) or turn on the node's *Continue On Fail* setting (the error item keeps the `runId`).

`error` is the error message alone (for example `"https://example.com/ is not on reduck.ai"`), or `null`. A run that cannot start at all (unknown script, invalid arguments, no browser available) is reported the same way, with `runId: null`.

**Several items.** The node runs one script per input item, one after the other, and waits for each.

**Rate limits.** Reduck limits requests per API key. The node waits and retries when told to, so *Return All* on a long run history can take a while.

**Stopping.** Stopping the workflow in n8n stops the node from waiting; a run already started goes on in Reduck.

**AI Agents.** The node can be used as a tool by the AI Agent node. Each tool node does one operation: add one set to *Script → Run* to let the agent run scripts, and another set to *Script → Get Many* to let it find them.

## Example workflow

[`examples/page-to-webhook.json`](examples/page-to-webhook.json) exposes one of your scripts as an HTTP endpoint for your own systems: a Webhook node, protected by a header token (*Header Auth*), receives a POST request, the Reduck node runs a script with the request body as its arguments, and a Respond to Webhook node sends back `{status, result, error}` as JSON. Import it in n8n (*Workflows → Import from File*), set your Reduck credential and a *Header Auth* credential for the webhook, pick your script in place of the example one, and activate the workflow. Keep the webhook protected: anyone who can call it runs your script.

## Compatibility

Tested with n8n 2.44.

## Resources

- [Reduck documentation](https://docs.reduck.ai/)
- [Reduck API reference](https://docs.reduck.ai/api-reference/) and [OpenAPI spec](https://reduck.ai/api/openapi.json)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## License

Reduck and the Reduck logo are trademarks of Conception AI; the MIT license does not grant rights to them.


[MIT](LICENSE.md)
