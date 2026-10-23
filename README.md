# n8n-nodes-reduck

This is an n8n community node for [Reduck](https://reduck.ai). It lets your workflows run the browser scripts you saved in Reduck and use their results.

A Reduck script does one task on one website: read the prices on a page, check that a page loads, fill in a form in an internal tool. You build and test scripts with the Reduck CLI or an AI coding assistant, then run them from n8n on a schedule, from a webhook, or as a tool of an AI Agent.

[Installation](#installation) · [Operations](#operations) · [Credentials](#credentials) · [Usage](#usage) · [Example workflow](#example-workflow) · [Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation, and install `n8n-nodes-reduck`.

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

**Choosing a script.** In *Script*, pick one of your scripts from the list, or switch to *By Path* and type `host/slug` (for example `example.com/get_prices`). For a script shared with you by another user or a project, type `owner/host/slug`.

**Arguments.** *Script Arguments* takes a JSON object shaped by the script's input schema. Use *Script → Get* to see which inputs a script takes. To build them from the incoming item, switch the field to *Expression*, for example `{{ JSON.stringify({ url: $json.url }) }}`.

**Where the script runs** (*Options → Browser*):

- *Default*: Reduck picks your paired browser.
- *Hosted by Reduck*: a cloud browser, nothing to install, if it is enabled on your plan. Add *Country* to run it from a given country.
- *Your Browser Extension*: your own Chrome, paired with the Reduck extension.
- *Local Device*: a machine paired with `reduck local`.
- *Specific Device*: one paired device, by its ID.

**Retries.** Leave the node's *Retry On Fail* setting off for scripts that change something on a website: a retry starts the script again.

**Output.** *Script → Run* returns one item:

```json
{
  "runId": "3b6b001d-44da-4096-afbf-cd5fac1060fb",
  "status": "success",
  "script": "@jane/example.com/get_prices",
  "result": { "...": "what the script returned" },
  "error": null,
  "startedAt": "2026-10-23T16:05:45.166Z",
  "finishedAt": "2026-10-23T16:05:46.790Z"
}
```

`status` is `success`, `error`, `cancelled`, or `queued` / `running` for a run you did not wait for. A run that fails, is cancelled, or is still going when *Max Wait* ends stops the workflow, unless you turn off *Options → Fail on Script Error* (the item is then returned with its status) or turn on the node's *Continue On Fail* setting (the error item keeps the `runId`).

**Stopping.** Stopping the workflow in n8n stops the node from waiting; a run already started goes on in Reduck.

**AI Agents.** The node can be used as a tool by the AI Agent node. Each tool node does one operation: add one set to *Script → Run* to let the agent run scripts, and another set to *Script → Get Many* to let it find them.

## Example workflow

[`examples/page-to-webhook.json`](examples/page-to-webhook.json) turns a web page into an HTTP endpoint: a Webhook node receives a POST request, the Reduck node runs a script with the request body as its arguments, and a Respond to Webhook node sends back `{status, result, error}` as JSON. Import it in n8n (*Workflows → Import from File*), set your credential, pick your script in place of the example one, and activate the workflow.

## Compatibility

Tested with n8n 2.44.

## Resources

- [Reduck documentation](https://docs.reduck.ai/)
- [Using Reduck with n8n](https://docs.reduck.ai/n8n/)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## License

[MIT](LICENSE.md)
