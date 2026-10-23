# Changelog

## 0.1.0

- First version: Script (Run, Get, Get Many) and Run (Get, Get Many), API key credential, usable as an AI Agent tool.
- Runs start with one REST call (`POST /run` on the Reduck run service), then the node polls the run until it ends or Max Wait passes.
- Browser choice (default paired browser, hosted, extension, local device, specific device), with Country for the hosted browser.
- Simplify on every read operation; errors reduced to their message; retries on rate limits.
