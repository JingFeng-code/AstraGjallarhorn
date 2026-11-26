# AstraGjallarhorn

[繁體中文](README.md) | English

A verification-first engineering toolkit for Pi Coding Agent: evidence-based repair, controlled configuration synchronization, recovery, and review without mandatory role menus.

**v0.3 development preview.** Four bounded Node.js, SQLite, C# and Vue repair cases passed local model acceptance in the previous private development baseline. A real browser/HTTP/ASP.NET Core/SQLite fixture passed scripted CI. This clean source snapshot requires its own verification; those historical results are not certification of this revision, arbitrary models or production projects. EF Core integration and cross-layer autonomous acceptance remain pending.

Features include dry-run configuration application, backups and conflict checks; command guard, checkpoints, task recovery, retry limits, diff review; language-server integration; optional modes, skills and explicitly configured quality contracts; optional Herdr handoff (off by default).

On Windows with PowerShell 7, Git, Node 24 and the compatible Pi version in [the manifest](manifests/packages.json), inspect the source then preview:

```powershell
pwsh -NoProfile -File scripts/apply.ps1 -StrictVersion
```

Review the plan before opting into writes. See [operations and verification](docs/operations-manual.md). Keep personal configuration exports in a separate private repository, never the public upstream. Never publish raw sessions, checkpoints or logs.

These tools are not OS sandboxes, complete secret scanners, or guarantees of correctness or zero provider costs. Review code and dependencies, use isolated synthetic workspaces, and explicitly authorize any paid operation.

[Security](SECURITY.md) · [MIT license](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md).
