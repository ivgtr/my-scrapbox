---
name: workspace-setup
description: Set up this repository's personal Cosense workspace through an explicit workspace-setup invocation, collecting the project URL interactively when omitted. Reading documentation or CLI guidance is not an invocation.
---

# Workspace setup

Use only after an explicit `$workspace-setup` or `/workspace-setup` invocation. A quoted example, README review, CLI output, or a request to implement this skill does not authorize personal setup. Follow the repository's `AGENTS.md` and use `README.md` as the source of operational details. Do not modify the official Cosense skill.

## Invocation

Start with the skill name alone; a project URL argument is optional.

Codex:

```text
$workspace-setup
```

Claude:

```text
/workspace-setup
```

## Required user input

Use Claude's `AskUserQuestion` or the available Codex question tool for the project URL if omitted, the sync mode, and login completion. The tool must accept an actual user response; if unavailable, report the missing tool and wait. Do not treat a preselected choice, timeout, or missing answer as consent.

First obtain the project URL: if explicitly supplied with the invocation, validate and use it without asking again. Otherwise, ask the user for their project URL (for example, `https://scrapbox.io/my-project`) and wait for the answer. Validate it using the current rules in `src/lib/config.mjs`; never guess a project or account. For an invalid URL, explain the error and request a corrected URL. Do not install dependencies, initialize a workspace, or write configuration until the URL is valid and the sync mode has been answered.

Before initialization, ask the user to choose one mode, explaining all three:

- `none` (recommended): session start displays offline state; no automatic sync.
- `fetch`: session start fetches articles and updates the index.
- `commit`: fetch plus an automatic commit of `archive/articles.json` only after successful sync on `workspace`. Other staged changes are preserved; configuration, memory, credentials, and index are excluded. Git identity and hooks are unchanged; no automatic push.

Wait for the mode answer before creating the workspace or writing configuration.

## Initialize

1. Confirm Node.js 24 or newer, a clean `main` working tree, no existing `workspace` branch, and no existing `cosense.config.json`, `memory/`, or `archive/`. If a prerequisite fails, report the cause and stop; do not overwrite, stash, reset, delete a branch, or switch to another initialization path.
2. Run `npm ci`, then `npm run workspace:init -- <projectUrl>`. If installation fails or dirties the tree, stop and report it. Keep the existing CLI arguments and configuration schema.
3. On the newly created `workspace`, read `cosense.config.json` and save the chosen `syncMode` alongside `projectUrl`. Do not add other keys. Do not run `session:start` during setup: its selected mode could sync or commit before setup verification is complete.

## User login and verification

Tell the user to run `npm run auth:login` in another terminal opened in this checkout, then use the question tool to wait for their completion response. Never run login yourself, ask for secrets, inspect credential contents, or put tokens in chat or command arguments.

If the user specifies a Service Account, read `.agents/skills/cosense/login.md`, check `npm run cosense -- login --help`, and guide them to run `npm run cosense -- login @project` in their own terminal. Use the same completion gate; `auth:check` is PAT-only.

After the user's completion response:

1. For PAT, run `npm run auth:check`. For Service Account, verify authentication through the initial sync.
2. Read `.agents/skills/workspace-sync/SKILL.md` and follow its sync and verification workflow for the authorized initial fetch. Reuse the login-completion response and successful PAT check above. This manual sync never commits, even for `commit` mode.
3. Read the existing `memory/index.md` before saving the chosen settings, decisions and reasons, verification date and evidence, incomplete work, and next action in workspace memory. Do not store secrets or personal memory on template `main`.

Report completed steps separately from failures. On failure, stop dependent work and retain successful steps. When resuming in the same conversation, check the current state and continue from the failed or unanswered step; never rerun a successful initialization. Do not push.
