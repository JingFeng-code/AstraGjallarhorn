# AstraGjallarhorn 跨電腦交接

開發分支 `feat/gate-recovery-foundation`，Draft PR [#3](https://github.com/JingFeng-code/AstraGjallarhorn/pull/3)。`main` 起點 `cf0f5248562ca3d061229ec0aa8d2f9b658227e4`。以本分支最新 commit 取得本文件。

## 目前狀態（2026-11-26）

v0.2 的所有必要能力均已實作、通過確定性測試與真實 Pi 工具調度，並已安裝到這台電腦的正式 Pi 1.6.0。逐項證據與判定見 [能力驗收：v0.2 Release Closure](docs/verification/capability-completion.md#v02-release-closure)。操作請看 [操作手冊](docs/operations-manual.md)，能力說明請看 [README 第 11 節](README.md#11-v02-完整能力)。

發布決定（合併、Release）仍由人工進行：未自動合併 PR、未刪除分支、未發布 Release。

## 已完成能力

Pi 1.6.0 相容、Session 模式隔離、Default／Deep Execution、固定版本套件、跨機同步與備份還原、Better Edit 2.21.0、Hashline、Tool Profiles、Retry Limit、pstack architect／correct／create-verification-skill、SQL／.NET／Vue Verification Harness、模型自主修復、Runtime Verification、原生 Context／Compaction／模型切換、Plan Review、手動 Git Checkpoint、手動 Herdr 交接、模型 A/B。

v0.2 本輪新增：TypeScript LSP、C# LSP、背景任務恢復、自動 Checkpoint、通用安全指令防護、Herdr 自動交接、Diff Review。

## 接手時先做

```powershell
git fetch; git switch feat/gate-recovery-foundation; git pull
git status --short --branch
pi --version                      # 期望 1.6.0
node --test tests/*.test.mjs
pwsh -NoProfile -File scripts/verify.ps1
```

RPC 與 Pi 實機測試需要 Pi 的 `cli.js` 路徑（見操作手冊第 5 節）。TypeScript LSP 測試需要 `ASTRA_TSLS` 指向 `~/.pi/agent/lsp/node_modules/typescript-language-server/lib/cli.mjs`。

## 目錄速查

| 路徑 | 內容 |
|---|---|
| `extensions/` | 第一方 Pi 擴充功能（同步到 `~/.pi/agent/extensions/`） |
| `tests/` | `*.test.mjs` 確定性測試；`*-rpc.mjs` 真實 Pi 調度；`real-model/` 真實模型與正式 Pi 實機；`lib/` 測試工具（腳本化提供者、假 hc） |
| `docs/verification/` | 驗收紀錄與 `evidence/` 原始輸出 |
| `manifests/` | 同步清單與固定版本（含 LSP 伺服器固定值） |
| `scripts/` | `export`／`apply`／`verify`／`verify-project` |
| `examples/` | SQL、.NET、Vue 驗證工程 |

## 已知阻塞與限制

目前沒有阻擋 v0.2 發布的必要能力。仍存在的限制（皆已記入驗收紀錄與操作手冊，不是待辦）：安全防護是啟發式政策而非 OS Sandbox；多 Agent 同時修改同一工作樹時 Checkpoint 無法分辨修改者；C# LSP 依賴機器上的 Microsoft C# VS Code 擴充功能且 CI 不涵蓋；Context Mode 外掛未採用，使用 Pi 原生 Compaction。

## 保護範圍

本專案只寫入 `~/.pi` 下的白名單路徑與 `~/.pi/agent/lsp`。不得修改 Claude Code、Codex、OpenCode、Herdr、hc、AstraAegis、其他 Astra 專案、共用 Skills、Ollama 全域設定。Pi 的認證、Provider、模型偏好、Theme、Alt+M、DeepSeek Stack、`astra-herdr.js` 保持不變，`scripts/verify.ps1` 檢查其中可檢查的部分。

## 歷史紀錄

早期 Gate、Sandbox 驗收與舊的 BLOCKED 狀態保存在 [gate-0-2](docs/verification/gate-0-2.md)、[gate-recovery](docs/verification/gate-recovery.md) 與能力驗收文件的前半部。判斷目前狀態請以能力驗收文件最後一節為準。
