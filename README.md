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

1. Sign in at [reduck.ai](https://reduck.ai) and create an API key in your settings.
2. In n8n, create a **Reduck API** credential and paste the key.

n8n checks the key when you save the credential.

## Usage

**Choosing a script.** In *Script*, pick one of your scripts from the list, or switch to *By Path* and type `host/slug` (for example `example.com/get_prices`). For a script shared with you by another user or a project, type `owner/host/slug`.

**Arguments.** *Script Arguments* takes a JSON object shaped by the script's input schema. Use *Script → Get* to see which inputs a script takes. You can use expressions, for example `{ "url": "{{ $json.url }}" }`.

**Where the script runs** (*Options → Browser*):

- *Hosted by Reduck* (default): a cloud browser, nothing to install. Add *Country* to run it from a given country.
- *Your Browser Extension*: your own Chrome, paired with the Reduck extension.
- *Local Device*: a machine paired with `reduck local`.
- *Specific Device*: one paired device, by its ID.

**Output.** *Script → Run* returns one item:

```json
{
  "runId": "807d9b89-379c-4108-9583-e6060eadab5c",
  "status": "success",
  "script": "example.com/get_prices",
  "result": { "...": "what the script returned" },
  "error": null
}
```

`status` is `success`, `error`, or, if the run is still going when the wait ends, `queued` or `running`. A run that ends in error stops the workflow, unless you turn off *Options → Fail on Script Error* or turn on the node's *Continue On Fail* setting.

**AI Agents.** The node can be used as a tool by the AI Agent node, so an agent can list your scripts and run them.

## Example workflow

[`examples/page-to-webhook.json`](examples/page-to-webhook.json) turns a web page into an HTTP endpoint: a Webhook node receives a request, the Reduck node runs a script, and a Respond to Webhook node sends back the script's result as JSON. Import it in n8n (*Workflows → Import from File*), set your credential and pick your script.

## Compatibility

Tested with n8n 2.x.

## Resources

- [Reduck documentation](https://docs.reduck.ai/)
- [Using Reduck with n8n](https://docs.reduck.ai/n8n/)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## License

[MIT](LICENSE.md)
