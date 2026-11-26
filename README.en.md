# AstraGjallarhorn

[繁體中文](README.md) | English

> Development preview / publication-preparation candidate. This is not a released v0.3. The source repository remains private pending the publication gate.

A verification-first toolkit for Pi Coding Agent on Windows. It aims to improve everyday engineering work through evidence, reproducible checks, controlled configuration synchronization, and recovery rather than model-specific role menus.

## Capabilities and evidence

- Configuration export/apply with dry-run, conflict detection, backups and restore.
- Command guard, Git worktree checkpoints, bounded retry, task journal and recovery, and read-only diff review.
- TypeScript and C# language-server integration; servers are not downloaded automatically.
- Optional Herdr handoff (disabled by default); no automatic provider switch or guarantee of zero provider charges.
- Explicit opt-in quality contracts: reproduce an approved regression before editing, rerun verification, review changes, and preserve protected tests. Four synthetic Node.js, SQLite, C# and Vue cases passed scripted CI and one local MiMo-model acceptance each. This is not general model or project certification.
- Cross-layer Vue browser / ASP.NET Core HTTP / SQLite fixture passed scripted CI; cross-layer autonomous model acceptance and EF Core integration are not yet complete.

## Getting started safely

Use the pinned Pi version from [manifests/packages.json](manifests/packages.json) (1.6.1 in this candidate) and PowerShell 7 on Windows. Inspect the trusted checkout and read the [Chinese operations manual](docs/operations-manual.md). Start with dry-run only:

```powershell
pwsh -NoProfile -File scripts/apply.ps1 -StrictVersion
```

Do not add `-Apply` until the plan, backups, package declarations and target directory have been reviewed. Do not install or enable paid providers merely to try this toolkit. Dependency restoration or provider use may require network access or incur costs. Never use a public repository as the destination for personal configuration exports. Keep personal sync in a private repository.

## Security and licensing

Extensions run with the Pi process's permissions. Command guard, redaction, checkpoints and quality gates are not OS isolation, a comprehensive DLP tool, or a guarantee of correctness. Use isolated test workspaces with synthetic data, review scripts before execution, and never share raw sessions, checkpoints, credentials or work-related logs.

See [SECURITY.md](SECURITY.md), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [publication readiness](docs/open-source-readiness.md). The first-party license is proposed, not granted by this preparation branch; existing third-party licenses remain intact.

The name refers to Gjallarhorn, Heimdall's horn in Norse mythology, as a metaphor for verified signals and configuration transfer. It is not a claim of real-time broadcast functionality.
