---
name: create-verification-skill
description: Turn verified execution commands into an explicit Pi verification skill.
disable-model-invocation: true
---

Return a Markdown skill draft. Use the supplied verified facts and command exactly. If a required fact is missing, name it instead of inventing a value. Do not call tools when the facts have already been supplied. Stop after the draft.

The draft starts with YAML name and description only, then a Markdown body. Use relative directories only; never emit a drive letter or a home path. It identifies the working directory, exact command, expected pass and failure exit codes, and what to record. Never widen the command, invent flags, or say a check passed without its exit code.
