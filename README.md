# Official [Reduck](https://reduck.ai) node for [n8n](https://n8n.io)

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/reduck-ai/n8n-nodes-reduck/main/images/reduck-x-n8n-dark.png" />
    <img src="https://raw.githubusercontent.com/reduck-ai/n8n-nodes-reduck/main/images/reduck-x-n8n-light.png" alt="Reduck × n8n" width="460" />
  </picture>
</p>

n8n is a powerful automation framework but faces key challenges:

- **No API exists**, e.g. Facebook groups have none since 2024.
- **Hard to get APIs**, e.g. Reddit gives an API key only after reviewing applications.
- **Inadequate APIs**, e.g. Facebook's API reads only Pages you manage.
- **Hard to set up credentials**, e.g. Google requires you to make an OAuth app first.

Reduck solves this by making it easy to write browser automation scripts with Agents, thanks to Reduck MCP, and then run them within n8n.

A script runs in your own browser (the Reduck extension), where you are signed in, or in a
Reduck managed browser. For example, workflows with Reduck can:

- Find LinkedIn profiles and send connection requests.
- Read and post in Facebook groups.
- Search Reddit and read every comment of a thread.

You can run scripts from the [Reduck library](https://reduck.ai/explore), or from ones you create yourself for custom integrations (see
[Building your own script](#building-your-own-script-and-using-it)).

## Requirements

- An [n8n](https://docs.n8n.io/hosting/) instance where you can install community nodes. The
  [quick start from the command line](#quick-start-from-the-command-line) needs n8n 2 or later.
- A [Reduck account](https://reduck.ai/#signin).
- The [Reduck extension](https://chromewebstore.google.com/detail/reduck/koccidjchcojlmgkdhibpgjbnhcoopio),
  paired with your account (see [pairing](https://docs.reduck.ai/#quick-start)). Scripts run on
  this browser by default. To run without it, set **Browser** to **Reduck Managed Browser**.

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
   Then select **Execute step**. The script runs on your paired browser, and `result` holds the
   stories:

   ![The Reduck node after Execute step: the run succeeded, and result lists the stories](https://raw.githubusercontent.com/reduck-ai/n8n-nodes-reduck/main/images/quick-start-run.png)

## Quick start from the command line

The same result with no clicks, for example from a script or an AI agent. You need n8n 2 or
later, and an API key from [API keys](https://reduck.ai/api-keys). The workflow runs on a Reduck
managed browser, so you do not need the extension. Stop n8n before you start: n8n reads
published workflows when it starts.

1. **Install the node:**

   ```bash
   mkdir -p ~/.n8n/nodes && cd ~/.n8n/nodes && npm install @reduck-ai/n8n-nodes-reduck
   ```

2. **Add your API key as a credential.** n8n encrypts the key when it imports the file:

   ```bash
   cat > reduck-credential.json <<EOF
   [{"id": "reduckQuickStart", "name": "Reduck API", "type": "reduckApi", "data": {"apiKey": "$REDUCK_API_KEY"}}]
   EOF
   n8n import:credentials --input=reduck-credential.json && rm reduck-credential.json
   ```

3. **Import and publish the workflow.** It answers a webhook with the top Hacker News stories:

   ```bash
   curl -sO https://raw.githubusercontent.com/reduck-ai/n8n-nodes-reduck/main/examples/hacker-news-webhook.json
   n8n import:workflow --input=hacker-news-webhook.json
   n8n publish:workflow --id=reduckHackerNews
   ```

4. **Start n8n, then call the workflow** from another terminal:

   ```bash
   n8n start
   ```

   ```bash
   curl http://localhost:5678/webhook/hacker-news
   ```

   The answer is the run. `result` holds the 10 top stories, and `id` links to the run's steps
   and screenshots at `https://reduck.ai/runs/<id>`.

## Examples

Import a workflow from [examples](https://github.com/reduck-ai/n8n-nodes-reduck/tree/main/examples)
(**Workflows > Import from File**), then select your Reduck credential in its Reduck node.

- [Does ChatGPT cite your brand?](https://github.com/reduck-ai/n8n-nodes-reduck/blob/main/examples/chatgpt-brand-visibility.json):
  every morning, asks ChatGPT your buyers' questions in the ChatGPT app and records whether the
  answer cites your site, names you, or cites others. The rows go to an n8n data table.
- [Top Hacker News stories, on a webhook](https://github.com/reduck-ai/n8n-nodes-reduck/blob/main/examples/hacker-news-webhook.json):
  answers `GET /webhook/hacker-news` with the front page as JSON. The
  [quick start from the command line](#quick-start-from-the-command-line) uses it.

## FAQ

<details>
<summary>Do I need an API key or an OAuth app for LinkedIn, Facebook or Reddit?</summary>

No. A script uses the site in a browser where you are already signed in.

</details>

<details>
<summary>What happens when a site signs me out?</summary>

The run fails and says that the browser is not signed in. Sign in to the site again in your
browser, and the next run works.

</details>

<details>
<summary>Paired browser or managed browser?</summary>

- **Paired browser** (the Reduck extension): for a site where you must be signed in. Chrome must
  be open on your computer.
- **Reduck managed browser**: for a site with no sign-in. Nothing runs on your computer. If the
  site refuses the run because it comes from a datacenter, set **Country** to connect from a home
  address in that country.

</details>

<details>
<summary>How much does it cost?</summary>

Reduck has a free plan. See [pricing](https://reduck.ai/pricing).

</details>