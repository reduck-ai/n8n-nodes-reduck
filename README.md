<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cdn.reduck.ai/logo-full-white.png" />
    <img src="https://cdn.reduck.ai/logo-full-dark.png" alt="Reduck" width="300" />
  </picture>
</p>

# @reduck-ai/n8n-nodes-reduck

The official [Reduck](https://reduck.ai) node for [n8n](https://n8n.io).

Reduck turns what you do on a website into a reusable script: search LinkedIn, read an inbox,
fill a form. This node runs those scripts in your n8n workflows, and lets an n8n AI agent run them
as tools.

## Install

On a self-hosted n8n, go to **Settings > Community nodes** and install
`@reduck-ai/n8n-nodes-reduck`. See the [n8n guide](https://docs.n8n.io/integrations/community-nodes/installation/).

Where you cannot install it, use the [MCP Client Tool](#without-the-node-the-mcp-client-tool) instead.

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
- **Region** and **Country**: for the managed browser only. Region is the datacenter the browser
  runs in. Country connects to the site from that country through a residential proxy, for a site
  that changes by country.

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

Import a workflow from [examples](https://github.com/reduck-ai/n8n-nodes-reduck/tree/main/examples)
(**Workflows > Import from File**), then select your Reduck credential in its Reduck node.

- [Does ChatGPT cite your brand?](https://github.com/reduck-ai/n8n-nodes-reduck/blob/main/examples/chatgpt-brand-visibility.json):
  every morning, asks ChatGPT your buyers' questions in the ChatGPT app and records whether the
  answer cites your site, names you, or cites others. The rows go to an n8n data table.

## Without the node: the MCP Client Tool

n8n Cloud installs only the community nodes that n8n has verified. Where you cannot install this
node, give an AI Agent the Reduck tools with n8n's own **MCP Client Tool** node:

1. On the **Tool** connector of an **AI Agent** node, add an **MCP Client Tool** node.
2. Set **Endpoint URL** to `https://mcp.reduck.ai` and **Server Transport** to
   **HTTP Streamable**.
3. Set **Authentication** to **Header Auth**, with a credential whose name is `X-API-Key` and
   whose value is your [Reduck API key](https://reduck.ai/api-keys).
4. In **Options > Timeout**, write `300000` (five minutes). The default of one minute is not
   sufficient: a script opens a real browser and loads a real page.
5. Set **Include Tools** to **Selected**, and select `list_scripts`, `read_script` and
   `run_script`. The other tools are for writing scripts, and an agent that only runs scripts
   does better with fewer tools.

To make sure that it works, ask the agent to run `whoami`. It tells you the Reduck account the
key belongs to.

## Not supported yet

- Running several scripts in one call.

## Compatibility

Tested with n8n 2.x.

## Resources

- [Reduck](https://reduck.ai)
- [Reduck documentation](https://docs.reduck.ai)
- [n8n community nodes](https://docs.n8n.io/integrations/#community-nodes)
