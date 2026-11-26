# AstraGjallarhorn

[繁體中文](README.md) | English

Controlled configuration synchronization and engineering verification tooling for Pi Coding Agent. v0.3 is a development preview; see GitHub Releases for published versions.

## Features

- Allowlisted configuration synchronization with dry runs, conflict protection, backup, and restore.
- Default and Deep Execution modes; modes do not switch the model or provider.
- LSP, Diff Review, command guards, checkpoints, retry limits, task recovery, and explicitly authorized handoff.
- The v0.3 single-agent flow can discover Architect and Correct skills on demand. It adds no roles, router, or fixed workflow.
- Verification evidence and quality gates report observed tool results and supported project checks; they do not claim that every change is verified.
- Natural-language recovery reads an interrupted task only after there is one candidate and the user confirms the context transfer. It does not rerun commands or restore files automatically.
- Checkpoint Preview is read-only. Actual restore still requires an explicit user command.

## Requirements and quick start

Windows, Git, PowerShell 7, and Pi 1.6.1 as pinned in the manifest. Node.js 24 is used by local tests; .NET SDK 10.0.401 and Microsoft Edge are needed for the matching examples and full-stack fixture. Project scripts do not upgrade Pi.

From the repository root, preview the apply plan:

    pwsh -NoProfile -File scripts/apply.ps1 -StrictVersion

Review the file plan, version, backups, and conflicts before adding -Apply to write changes. See the [operations manual](docs/operations-manual.md).

## Public and private data boundary

Export defaults to a dry run. To write, pass -Apply and explicit -RepoPath; authenticated GitHub CLI (gh) must confirm a private GitHub repository. Public, internal, unknown and unsupported destinations are refused. Use -NoDiff when previewing private settings to avoid diffs in logs.

The public repository is for generic code, tests, and documentation. Keep personal Pi settings, provider credentials, sessions, backups, raw acceptance output, company data, and private work records local or in a separate private repository. Do not mirror-push private refs.

Fixtures use synthetic data. Scripts and third-party packages run with the user's privileges; they are not an OS sandbox. Providers and model services may incur charges, which users must check independently.

[Security policy](SECURITY.md) · [MIT license](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
