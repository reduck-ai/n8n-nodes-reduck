---
name: improve-prompt
description: Improve a prompt that the Reduck node's Request Review answers under, from your
  rulings on the review page: draft a new version, score it on your past rulings, and make it
  live if it is better. Use when drafts or verdicts are often wrong, or when asked to "improve
  the prompt".
---

# Improve a prompt

You need the prompt's name and its app id: a `review_url` is `flock.reduck.ai/app/<app id>/…`.
Sign in once with `npx @reduck-ai/cli@latest login`. Below, `flock` means
`REDUCK_EXPERIMENTAL=1 npx @reduck-ai/cli@latest flock … --app <app id> --host https://flock.reduck.ai`.

1. **Read** what the live version got wrong: `flock decision list --prompt "<name>" --unscored`,
   then `flock decision get <id>`. Read each note. A note about the thread, not the answer
   ("not the right pain"), is a fault of the prompt that chose the thread.
2. **Draft**: `flock prompt get "<name>"`, change it, then `flock prompt edit "<name>" --file new.md`.
   It saves version N as a draft. Nothing changes for the workflow.
3. **Score**: `flock prompt eval "<name>@N"`, and `flock prompt eval "<name>"` for the live one.
   For a prompt that answers in text, add `--judge` first, to check that the judge agrees with you.
4. **Ship** only if it is better: `flock prompt promote "<name>@N"`. The next Request Review uses it.
   To go back, promote the old version.

**Better** means more cases passed. With the same number, the shorter prompt wins. A tie is a loss.
A difference of 3 cases or fewer is noise. Do not try to fix the last miss.

The workflow's Set Prompt node writes its own text as the live version each time it runs. After a
promote, copy the new text into it, or do not run it.
