<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cdn.reduck.ai/logo-full-white.png" />
    <img src="https://cdn.reduck.ai/logo-full-dark.png" alt="Reduck" width="300" />
  </picture>
</p>

# @reduck-ai/n8n-nodes-reduck

The official [Reduck](https://reduck.ai) node for [n8n](https://n8n.io).

Reduck enables Agents to write, run and maintain browser automation scripts to automate sites with no API, such as LinkedIn, WhatsApp, Reddit, etc.

With Reduck n8n node, users can run scripts from our library or custom writen ones to automate workflows such as:
- ...

## Requirements

- A [Reduck account](https://reduck.ai/#signin).
- To run scripts on your own Chrome: the
  [Reduck extension](https://chromewebstore.google.com/detail/reduck/koccidjchcojlmgkdhibpgjbnhcoopio),
  paired with your account. See [pairing](https://docs.reduck.ai/#quick-start). The default,
  a Reduck managed browser, needs nothing more.

## Quick start

1. **Install the node**, then restart n8n:

   ```bash
   mkdir -p ~/.n8n/nodes && cd ~/.n8n/nodes && npm install @reduck-ai/n8n-nodes-reduck
   ```

   For Docker and other setups, see the
   [n8n guide](https://docs.n8n.io/integrations/community-nodes/installation/).

2. **Sign in.** Add a **Reduck** node to a workflow. In **Credential**, select **Create new
   credential**, then **Connect**, and approve n8n on Reduck.

   ![The new Reduck OAuth2 API credential, with its Connect button](https://raw.githubusercontent.com/reduck-ai/n8n-nodes-reduck/main/images/quick-start-connect.png)

   To use an API key instead, create a **Reduck API** credential with a key from
   [API keys](https://reduck.ai/api-keys), and select it in **Credential**.

3. **Run a script.** In **Script**, search `hacker news` and select **Top Hacker News stories**.
   Then select **Execute step**. `result` holds the stories:

   ![The Reduck node after Execute step: the run succeeded, and result lists the stories](https://raw.githubusercontent.com/reduck-ai/n8n-nodes-reduck/main/images/quick-start-run.png)

## Examples

Import a workflow from [examples](https://github.com/reduck-ai/n8n-nodes-reduck/tree/main/examples)
(**Workflows > Import from File**), then select your Reduck credential in its Reduck node.

- [Does ChatGPT cite your brand?](https://github.com/reduck-ai/n8n-nodes-reduck/blob/main/examples/chatgpt-brand-visibility.json):
  every morning, asks ChatGPT your buyers' questions in the ChatGPT app and records whether the
  answer cites your site, names you, or cites others. The rows go to an n8n data table.

  ## Features

  ## Building your own script and using it