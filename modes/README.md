# Pi Agent 工作模式（mode-switch）

兩種模式，模型自由切換，Skills 依模式載入。

| 模式 ID | 顯示名稱 | 行為 |
|---|---|---|
| `default` | 一般模式 | Pi 原生行為；不加入任何 deepseek-stack 規則，不載入 ds-* Skills。 |
| `deep-execution` | 深度執行 | 規劃 → 執行 → 驗證 → 修正；載入 `ds-*` Skills 與工作規則。 |

模式只決定 Skills 與系統提示中的工作規則。**不會**變更 Provider、Model、Thinking Level、Tools、MCP 或既有 Session。

## 切換

- 快捷鍵：`Alt+M`（一般模式 ↔ 深度執行）。
- 指令：
  - `/mode` 或 `/mode status`：顯示目前模式、模型、已載入 Skills、外掛工具。
  - `/mode use default`：切換到一般模式。
  - `/mode use deep-execution`：切換到深度執行。
  - `/mode toggle`：在兩種模式間切換。
  - `/mode hotkey`：以快捷鍵相同的程式路徑切換（診斷用）。
- 切換會在目前 Session 內執行 Pi 的 `/reload`：保留對話、模型與工具，不需重新啟動。

## 檔案

| 路徑 | 用途 |
|---|---|
| `~/.pi/agent/extensions/mode-switch.ts` | 模式擴充功能（官方 Extension API）。 |
| `~/.pi/agent/mode-state.json` | 目前模式。 |
| `~/.pi/modes/deep-execution/instructions.md` | 深度執行工作規則（每回合附加到系統提示）。 |
| `~/.pi/modes/deep-execution/skills/ds-*` | deepseek-stack Skills（**不在** Pi 自動掃描目錄）。 |

`ds-*` Skills 只在 `deep-execution` 模式由 `resources_discover` 事件加入；`default` 模式完全不會看到它們。

## 來源

- deepseek-stack：<https://github.com/aicodeking/deepseek-stack>（MIT），匯入 `main` 提交 `d4f1ebe72e8314c3a0c6135bb82f623c650f7218`（2026-10-28）。
- 授權文件：`~/.pi/modes/deep-execution/deepseek-stack-LICENSE`。

## 驗證

模式狀態請在 Pi 互動介面執行 `/mode status`（`pi --print` 會把 `/` 開頭的輸入當成一般提示送給模型，不是指令）。

自動化驗證請用 pi-config 儲存庫的腳本（以 Pi RPC 模式取得可發現指令，不需 TTY、不呼叫模型）：

```powershell
pwsh -File "$HOME\Documents\pi-config\scripts\verify.ps1"
```

應可看到：深度執行模式 `ds-* Skills：7 個`；一般模式 `0 個`。Alt+M 實際切換需人工於 TTY 驗證。

## 還原

1. 刪除 `~/.pi/agent/extensions/mode-switch.ts`。
2. 刪除 `~/.pi/modes/`（內含 ds-* Skills 與工作規則）。
3. 刪除 `~/.pi/agent/mode-state.json`。
4. 執行 `/reload` 或重新啟動 Pi。

若曾安裝 pi-profile-switch（本機證實無法在 Windows 運作）：
`npm uninstall -g pi-profile-switch`，並視需要刪除 `~/.pi/agent/skills/profile-config`。
