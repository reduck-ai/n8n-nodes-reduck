# @reduck-ai/n8n-nodes-reduck

The official [Reduck](https://reduck.ai) node for [n8n](https://n8n.io).

Reduck turns what you do on a website into a reusable script: search LinkedIn, read an inbox,
fill a form. This node runs those scripts in your n8n workflows, and lets an n8n AI agent run them
as tools.

## Install

On a self-hosted n8n, go to **Settings > Community nodes** and install
`@reduck-ai/n8n-nodes-reduck`. See the [n8n guide](https://docs.n8n.io/integrations/community-nodes/installation/).

## Credentials

Choose one in the node's **Authentication** field:

- **API Key** (the default): in the Reduck dashboard, open [API keys](https://reduck.ai/api-keys)
  and create a key. Then create a **Reduck API** credential in n8n and paste the key. Keep the
  default **Reduck URL**.
- **OAuth2**: create a **Reduck OAuth2 API** credential and select **Connect**. Sign in to Reduck
  and approve n8n. There is no client ID or secret to enter.

## Run a script

The node runs a script, waits until the run finishes, and returns the run.

- **Script**: pick one from the list (your scripts, your projects' scripts and the official
  catalogue), or give its address, such as `reduck/news.ycombinator.com/top_stories`.
- **Arguments**: one field for each argument the script takes, read from the script itself.
- **Files**: a script that takes a file shows one field for each file input, such as
  `attachment (binary property)`. Write the name of the binary property of the input item that
  holds the file, for example `data`. The page gets the file with the name of the input. A file can
  be approximately 3 MB.
- **Browser**: a Reduck managed browser (the default), or one of your paired browsers.

The output is the run. `result` holds what the script returned:

```json
{
  "id": "15783c22-bb29-43a6-956f-7ea3d3852c25",
  "status": "success",
  "result": { "…": "the script's output" },
  "started_at": "2026-10-25T10:09:34.034Z",
  "finished_at": "2026-10-25T10:09:34.633Z"
}
```

If the script fails, the node fails with the script's message. Turn on **Continue On Fail** to get
`{ "error": "…" }` instead.

## Use it as an AI agent tool

Connect the **Reduck Tool** to an **AI Agent** node. Pick the script, and let the agent fill the
arguments: select the sparkle icon next to a field, or use `{{ $fromAI('query') }}`.

## Examples

Import a workflow from [examples](examples) (**Workflows > Import from File**), then select your Reduck credential in its Reduck node.

- [Does ChatGPT cite your brand?](examples/chatgpt-brand-visibility.json): every morning, asks ChatGPT your buyers' questions in the ChatGPT app and records whether the answer cites your site, names you, or cites others. The rows go to an n8n data table.

## Not supported yet

- Running several scripts in one call.

## Compatibility

Tested with n8n 2.x.

## Resources

- [Reduck](https://reduck.ai)
- [Reduck documentation](https://docs.reduck.ai)
- [n8n community nodes](https://docs.n8n.io/integrations/#community-nodes)
