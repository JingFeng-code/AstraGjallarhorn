# Operations and verification / 操作與驗證

Development preview; supported test environment is Windows with PowerShell 7, Git, Node.js 24 and the Pi version pinned in `manifests/packages.json`. This is not production certification.

## Installation

Use a trusted checkout. Inspect the manifest, scripts and target paths. Preview `pwsh -NoProfile -File scripts/apply.ps1 -StrictVersion` first; only after reviewing conflicts, backups and package declarations opt into `-Apply`. Re-run `pwsh -NoProfile -File scripts/verify.ps1`. Missing tools, unsupported versions and manual TTY checks must not be treated as passes. Package installation and provider credentials are separate operations requiring authorization. The project does not upgrade Pi.

## Private synchronization

Use a separate private clone/repository. `scripts/export.ps1 -DryRun` previews local exports, and the actual export writes only to the selected repository; review every staged file and remote before committing. Never export to the public upstream, push private checkpoint refs, or use mirror push. Credentials, sessions, task journals, provider authentication and local runtime state remain local/private. Regex scanners and ignore rules are only partial safeguards.

Restore via `scripts/apply.ps1 -Restore -RestoreLatest` to preview the latest backup; inspect before adding `-Apply`. Read the actual script help before selecting a different backup or force. Do not overwrite concurrent user edits without consent.

## Verification

- `node --test tests/*.test.mjs`: deterministic unit tests; optional LSP cases require their configured servers.
- `pwsh -NoProfile -File scripts/verify-project.ps1 -Suite sql`, `-Suite dotnet`, or `-Suite vue`: see [SQLite](../examples/sql/README.md), [C#](../examples/dotnet/README.md), [Vue](../examples/vue/README.md) for prerequisite setup.
- Scripted Pi RPC runs in the reviewed GitHub Actions workflow. No external model is required.
- Isolated local model tests in `tests/real-model/` require an existing compatible Pi executable and local model. Inspect each harness's prerequisites and arguments before executing. Never send private data to an external model. `scripts/accept-v03.ps1 -SkipModel` checks the specified core suite; it does not certify every stack or machine.
- [Full-stack fixture](../examples/fullstack/README.md) exercises real browser/HTTP/ASP.NET Core/SQLite with synthetic data, not EF Core.

No test pass waives human review. Report missing tools, failures, skipped checks and evidence limitations separately. Quality gates, command guard, checkpoint and recovery are tool-level features, not OS isolation. Keep the optional handoff disabled unless the receiver and billing constraints have been reviewed.
