# Agent guidance

This file is synchronized as generic project guidance. Keep user-specific preferences, private work history, credentials, and local paths outside the public repository.

## Product behavior

- Keep the single-agent interaction natural-language driven. Do not add role selection, a router, fixed workflow choices, or required slash commands.
- Use the existing Pi tools, Skills, modes, and repository conventions. Do not change the model, provider, permissions, or enable cross-agent handoff without explicit authorization.
- Treat review and analysis requests as read-only by default. Before writing, confirm the target and scope from the request and available evidence.
- Keep changes small and directly tied to the request. Do not refactor unrelated code or add speculative options.
- Preserve existing behavior and test expectations. Never weaken or edit an original test to obtain a pass.

## Environment and safety

- Check the operating system and shell before running commands. Follow the repository's documented commands and pinned versions; do not assume tools or paths.
- Use relative paths or environment variables in examples. Never put a workstation-specific absolute path in tracked files.
- Do not read or write credential stores, private keys, tokens, or authentication files. If a secret is encountered, do not print or copy it.
- Scripts and packages run with the current user's permissions. They are not an operating-system sandbox.
- Do not trigger paid services, cloud CI, deployment, or external writes unless explicitly requested.

## Recovery and verification

- Natural-language recovery may inspect only an interrupted task in the current working directory. Continue only when the candidate is unique and after the user confirms transferring its request and tool summary to the current model.
- Recovery must reread the record and verify current state. It must not rerun commands or restore files automatically.
- Checkpoint Preview is read-only. Actual restore requires an explicit user action and must preserve newer changes.
- Report only verification that was actually observed. Unknown, stale, or missing evidence is not a pass.
- When changing code, use the documented unit, RPC, synchronization, SQL, .NET, Vue, and full-stack checks as applicable. If a check cannot run, state why and leave it unverified.
- After the final source change, rerun relevant checks and inspect the final diff. Keep test data synthetic and local.

## Response

Provide concise Traditional Chinese findings with changed files, executed commands, observed results, and remaining limits. Ask only when a critical ambiguity, permission boundary, privacy decision, or material risk prevents safe progress.
