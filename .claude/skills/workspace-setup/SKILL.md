---
name: workspace-setup
description: Set up this repository's personal Cosense workspace through an explicit user invocation, asking for the project URL when omitted.
disable-model-invocation: true
---

Invoke as `/workspace-setup`; a project URL argument is optional. Read and follow `.agents/skills/workspace-setup/SKILL.md` from the repository root, including its URL input and validation steps. Optional invocation arguments: $ARGUMENTS

Use `AskUserQuestion` for the required user responses. If unavailable, report the missing tool and wait. Do not duplicate the shared procedure here.
