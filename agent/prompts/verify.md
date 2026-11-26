---
description: 跑專案的測試、型別檢查與 lint，修正到通過
argument-hint: "[範圍或套件]"
---
先讀專案設定（`package.json`、`pyproject.toml`、`Makefile`、`justfile` 等），找出這個專案實際的 test、typecheck、lint 指令。範圍：${1:-整個專案}

在 AstraGjallarhorn，使用和 CI 相同的入口 `pwsh -NoProfile -File scripts/verify-project.ps1`。如果只驗證其中一組，使用 `-Suite sql`、`-Suite dotnet` 或 `-Suite vue`。先依 README 還原該組依賴，保留實際退出碼。

依序執行；失敗時讀取診斷、修正根因，再用相同命令驗證。同一個失敗最多重跑三次，每次重跑前需有新的證據或修正。若仍失敗或所需工具無法使用，停止重試，列出重現命令、最近退出碼、已修改的檔案及下一個有根據的檢查，供 Herdr 手動交接。
不要只跑一個指令就說「驗證完成」；最後列出：

- 執行的指令
- 通過／失敗數
- 剩餘風險或未驗證項目
