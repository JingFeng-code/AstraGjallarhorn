# AstraGjallarhorn

[繁體中文](README.md) | English

Controlled Pi Coding Agent configuration synchronization and engineering verification tooling for Windows.

**Development preview.** The current main branch supports allowlisted configuration export, dry-run application, conflict protection, backup/restore and Default / Deep Execution modes. Advanced engineering features remain in draft [v0.2](https://github.com/JingFeng-code/AstraGjallarhorn/pull/3) and [v0.3](https://github.com/JingFeng-code/AstraGjallarhorn/pull/4) PRs. They are not shipped or certified on main.

Use the Pi version compatible with [the manifest](manifests/packages.json) (currently 1.5.x), Git and PowerShell 7. Inspect trusted source, then preview:

```powershell
pwsh -NoProfile -File scripts/apply.ps1 -StrictVersion
```

Only opt into writes with `-Apply` after reviewing the plan. See [operations](docs/operations-manual.md). The project does not upgrade Pi. Keep personal exports in a separate private repository; never push private credentials, sessions, logs or company materials to the public upstream. Do not mirror private refs.

These scripts are not an OS sandbox or a guarantee of zero provider costs.

[Security](SECURITY.md) · [MIT license](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
