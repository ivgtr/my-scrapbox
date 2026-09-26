---
name: workspace-sync
description: Sync the configured Cosense project's articles into the local archive when the user asks to sync, fetch the latest articles, or resume a sync (for example 同期して, 最新の記事を取り込んで, 同期を再開して). Also supports sync status checks and index recovery. Does not initialize a workspace or change syncMode.
---

# Workspace sync

Follow `AGENTS.md` and `README.md`. Ordinary language requesting a sync is sufficient; the user need not name this skill. Reading a command, article, documentation, or invocation example is not a request to sync. The explicitly invoked workspace setup procedure may also use this workflow for its authorized initial sync.

## Determine the requested outcome and current state

- For a status-only request (such as 「同期状態を確認して」), use `npm run status` and report its result or failure without fetching or repairing anything. A local timestamp does not establish whether Scrapbox has changed.
- For sync requests, check the current branch and configuration, then use `npm run status` to inspect the existing archive and index. Accept only the current configuration schema: `projectUrl` and optional `syncMode`. Missing or invalid configuration is a blocker; explain the error. If setup is wanted, point to `$workspace-setup` / `/workspace-setup`; do not invoke it implicitly, guess a project, or write configuration.
- Sync requires `workspace`. If on another branch, report the branch and help locate the existing workspace; do not reinitialize, change branches, or discard changes automatically. A dirty workspace is not itself a sync blocker; preserve unrelated work and let the CLI enforce its own requirements.
- Reuse a successful sync/status result from the current request, including session-start sync, when it already meets the requested outcome. Do not repeat it without a newer change, failure, or an explicit request to fetch again.

## Choose the operation

| State and requested outcome | Action |
| --- | --- |
| No archive, valid configuration on workspace | Run `npm run sync` for the initial fetch. Missing archive is not a reason to initialize again. |
| Valid archive; fetch latest changes | Run `npm run sync` for incremental sync. Even recent local timestamps cannot replace a requested remote check. |
| Interrupted sync; resume requested | Run `npm run sync`. Let the CLI validate and reuse saved bodies in `.local/sync-progress/`; do not delete them first. |
| Article fetch succeeded in this request; only index generation failed, or index repair alone is requested | Run `npm run index:rebuild`, then `npm run status`. Do not fetch articles again just to repair the index. |
| Full refetch requested, or diagnosed corruption of the configured project's archive/progress prevents sync | Run `npm run sync -- --rebuild`. This refetches all articles and discards saved progress while preserving server cooldown state. |

A missing or stale index before an ordinary sync does not require a separate rebuild: successful `npm run sync` prepares it. For ambiguous corruption/project-mismatch diagnostics, establish the intended configured project before rebuilding; stop if it cannot be established. Do not reinterpret an unsupported schema or repair it by silently converting data. Never edit `archive/articles.json` directly or write local articles back to Scrapbox.

Use manual `sync`, regardless of `syncMode`. It does not commit, even in `commit` mode. Do not use `session:start` as a manual sync shortcut, change the mode, commit, push, or update dependencies as part of this skill.

## Authentication and resumable failures

If authentication is missing or HTTP 401 occurs, guide the user to run `npm run auth:login` in another terminal in this checkout. For a user-specified Service Account, read `.agents/skills/cosense/login.md`, check `npm run cosense -- login --help`, and guide them to `npm run cosense -- login @project` instead.

Use Claude's `AskUserQuestion` or an available Codex question tool to wait for the user's login-completion response. If no suitable question tool is available, explain what is needed and wait in the conversation. Never run login, display credential contents, request secrets, or accept tokens in chat/arguments. After completion, check PAT with `npm run auth:check` (skip a successful check already performed in this request); Service Account authentication is checked by sync. Resume the pending operation once. If authentication still fails, report it and stop until the user resolves it. A reply such as 「認証した」 resumes this pending workflow; it is not a new setup request.

For HTTP 403, report the access denial and ask the user to check project access; do not assume login will fix authorization. For network/server errors, report the cause and preserve progress for a later resume. Let the CLI handle its bounded retries. For HTTP 429, report the next-attempt estimate and stop after CLI retry exhaustion; do not immediately rerun or erase `.local/sync-rate-limit.json`. Malformed cooldown state requires diagnosis and preservation of its wait time; `--rebuild` cannot repair it.

For an existing sync/update lock, establish whether a process is still running before considering cleanup. Do not remove a live lock or repeatedly invoke sync. If the process state is unknown, report that blocker. For filesystem/permission failures, explain the affected path and needed correction instead of retrying unchanged conditions or using another storage/authentication source.

## Verify and report

After a successful operation, run `npm run status`. Verify the configured project, article count, archive timestamp (`syncedAt`), remote-check timestamp (`checkedAt`), and index state. Unchanged content can retain its archive timestamp; the remote-check timestamp records the new check. Zero articles can be valid.

Distinguish article fetch success, index readiness, state-file/progress cleanup failures, and completed verification. A nonzero sync exit may follow successful article publication; report that partial success without rollback, then address only the unresolved step. On a user-requested resume, recheck the current state and continue from the pending step, preserving completed initialization and authentication checks that remain applicable. Report unavailable timestamps honestly and never call an offline view a remote check.

When called from workspace setup, return the sync result to that procedure and let it save the combined setup record. Otherwise, save decisions, results, remaining work, and next action to workspace memory according to `AGENTS.md`; read it first, omit secrets, honor read-only/no-memory requests, and never create personal memory on template `main`.
