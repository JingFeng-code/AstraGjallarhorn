# AstraGjallarhorn v0.2 操作手冊

適用：Windows、Pi 1.6.0、Node.js 24.18、PowerShell 7。所有路徑由 `$HOME` 推導。

## 1. 安裝內容清單

### Pi 套件（`settings.json` 固定版本）

| 套件 | 版本 | 用途 |
|---|---|---|
| `pi-agnes-tools` | 0.3.7 | 既有 Provider 工具 |
| `pi-ollama-cloud` | 0.13.1 | Ollama Cloud Provider |
| `pi-better-edit` | 2.21.0 | 行錨點 `read`／`edit`，過期拒寫 |
| `@ollama/pi-web-search` | 未固定（既有，非本專案管理） | 網路搜尋 |

### 第一方擴充功能（`~/.pi/agent/extensions/`，由 `manifests/pi-config.json` 同步）

| 檔案 | 能力 |
|---|---|
| `mode-switch.ts` | Default／Deep Execution，Alt+M |
| `retry-limit.js` | `/retry-limit`：相同或連續失敗第三次停止 |
| `hashline.js` | `/hashline`、`/hashreplace` |
| `tool-profile.js` | `/tool-profile local\|cloud\|review\|restore\|status` |
| `command-guard.js` | `/guard`：通用安全指令防護 |
| `checkpoint.js` | `/checkpoint`：自動 Checkpoint |
| `task-recovery.js` | `/task`：任務日誌、續接、Timeout |
| `handoff.js` | `/handoff-auto`：Herdr 自動交接（預設關） |
| `diff-review.js` | `review_diff` 工具、`/review-diff` |
| `lsp.js` | `lsp_diagnostics`／`lsp_definition`／`lsp_references`、`/lsp` |
| `astra-herdr.js` | 既有 Herdr 狀態回報（不由本專案管理，未更動） |

### Skills

`architect`、`correct`、`create-verification-skill`（pstack，MIT，皆為 `/skill:<name>` 明確呼叫）；Deep Execution 模式的 7 個 `ds-*` Skills；`agent/prompts/` 的 `verify`、`commit`、`review` 範本。

### 外部伺服器（不隨 Git 同步、不自動下載）

| 伺服器 | 位置 | 固定 |
|---|---|---|
| typescript-language-server + typescript | `~/.pi/agent/lsp/node_modules` | 6.1.0／5.9.3，`verify.ps1` 檢查 |
| Roslyn Language Server | Microsoft C# VS Code 擴充功能的 `.roslyn` 目錄，或 `ASTRA_ROSLYN_LS` | 實測 ms-dotnettools.csharp 2.160.4，Authenticode 簽章有效 |

## 2. 安裝與驗證（含備份）

```powershell
git clone --branch feat/gate-recovery-foundation https://github.com/JingFeng-code/AstraGjallarhorn.git "$HOME\Documents\pi-config"
cd "$HOME\Documents\pi-config"
pwsh -File scripts\apply.ps1 -StrictVersion          # 預覽（Dry Run）：新增／更新／衝突
pwsh -File scripts\apply.ps1 -StrictVersion -Apply   # 先備份再寫入，輸出還原指令
npm install --prefix "$env:USERPROFILE/.pi/agent/lsp" --ignore-scripts --save-exact --no-audit --no-fund typescript@5.9.3 typescript-language-server@6.1.0
pwsh -File scripts\verify.ps1                        # 期望 0 FAIL；Alt+M 為人工項
```

套用後重新啟動 Pi 或執行 `/reload`。

## 3. 備份、還原、跨機同步

- 每次 `apply.ps1 -Apply` 備份到 `$env:LOCALAPPDATA\pi-config\backups\<時間戳>-<id>\`，並印出還原指令。還原先預覽：`pwsh -File scripts\apply.ps1 -Restore -RestoreFrom <備份路徑>`，確認後加 `-Apply`。套用後被改過的檔案視為衝突，回傳 3 且不寫入。
- 跨電腦：來源電腦 `scripts\export.ps1` → 檢查 `git diff` → commit／push；目標電腦 `git pull` → `apply.ps1`（預覽）→ `apply.ps1 -Apply` → LSP 安裝命令 → `verify.ps1`。Roslyn 隨目標電腦的 VS Code C# 擴充功能提供，沒有安裝時 C# LSP 工具回報 NOT FOUND，其餘功能不受影響。
- 不同步：`auth.json`、模型偏好、`mode-state.json`、Session、`~/.pi/agent/tasks`、`handoffs`、checkpoint refs（在各自專案的 `.git` 內）。
- 完整移除 v0.2 新增能力：用上述備份還原，或刪除 `extensions/` 內六個新檔（`command-guard`、`checkpoint`、`task-recovery`、`handoff`、`diff-review`、`lsp`）與 `~/.pi/agent/lsp`，重新啟動 Pi。

## 4. 日常使用

### 一次完整的修復流程

1. 開 Pi 在專案目錄。看到 `Checkpoint <id> saved before the task`。
2. 交辦任務。模型編輯後可呼叫 `lsp_diagnostics <檔案>`。`CLEAN` 才表示伺服器確認該檔無錯誤；`INCONCLUSIVE` 用專案編譯／測試指令代替。
3. 高風險指令會被 `command-guard` 要求核准或直接拒絕。
4. 不滿意：`/checkpoint restore <id>` 預覽，`--apply` 還原。
5. 審查：`/review-diff`。
6. 照專案慣例提交（Pi 不自動 commit）。

### 設定速查

| 目標 | 指令 |
|---|---|
| 授權另一個目錄可寫 | `/guard allow E:\Astra\OtherProject` |
| 所有需核准的呼叫改為直接拒絕 | `/guard strict` |
| 暫時關閉防護（不建議） | `/guard off`，`/guard enforce` 恢復 |
| 關閉自動 Checkpoint | `/checkpoint off` |
| 任務逾時 30 分鐘取消 | `/task timeout 30` |
| 啟用 3 次失敗上限 | `/retry-limit on`（或 `strict`） |
| 啟用自動交接 | `/retry-limit on` → `/handoff-auto on <terminal> --no-extra-cost` → `/handoff-auto check` |
| 關閉自動交接 | `/handoff-auto off` |
| 查看伺服器狀態／停止 | `/lsp status`、`/lsp stop` |

### Pi 異常結束之後

重新在同一目錄開 Pi。若出現 `Unfinished task <id> found`：`/task list` 看紀錄；`/task resume <id>` 讓模型依證據安全續接；`/task discard <id>` 放棄；`/task orphans` 查殘留子程序。需要時 `/checkpoint restore <id>` 預覽回到任務前。

## 5. 驗收與回歸

| 層級 | 指令 |
|---|---|
| 確定性單元測試 | `node --test tests/*.test.mjs`（設定 `ASTRA_TSLS` 才會執行 TypeScript LSP；有 Roslyn 才執行 C#） |
| 真實 Pi 工具調度（腳本化提供者） | `node tests/<name>-rpc.mjs <pi cli.js>`：`command-guard`、`checkpoint`、`handoff`、`task-recovery`、`diff-review`、`lsp`、`mode`、`retry-limit` |
| 真實模型任務（本地 Ollama） | `node tests/real-model/run.mjs <pi cli.js> lsp-ts\|lsp-cs\|diff-review\|guard-normal-loop` |
| 正式 Pi 實機 | `node tests/real-model/formal.mjs <pi cli.js>` |
| 同步與還原 | `pwsh -File tests/sync.ps1`、`pwsh -File scripts/verify.ps1` |

Pi CLI 路徑：`$HOME\.pi\agent\install\releases\1.6.0\node_modules\@earendil-works\pi-coding-agent\dist\cli.js`。

## 5.1 Roslyn 相依與固定版本

C# LSP 使用 Microsoft C# VS Code 擴充功能（`ms-dotnettools.csharp`）隨附的 Roslyn Language Server，Pi 不下載它。已測組合與雜湊記錄在 `manifests/packages.json` 的 `lsp.csharp`（擴充功能 2.160.4、伺服器 5.12.0-1.26452.1、.NET SDK 10.0.401）。`scripts/verify.ps1` 檢查：找不到為 WARN（只影響 C# LSP 工具）、簽章無效為 FAIL、版本與已測雜湊不同為 WARN（請執行 `node --test tests/lsp-cs.test.mjs` 確認相容）。需要固定版本時，用環境變數 `ASTRA_ROSLYN_LS` 指向你審查過的 `Microsoft.CodeAnalysis.LanguageServer.dll`。

## 5.2 自動交接的操作注意

- 啟用前先 `/retry-limit on`，並確認接收者是專用且閒置的終端、工作目錄與 Pi 相同；`/handoff-auto check` 隨時可重新檢查。
- 每小時最多 3 次（帳本 `~/.pi/agent/handoffs/ledger.json`）。大量測試後被擋下是預期行為；要重來可以把該檔改名備份。
- 摘要檔會遮罩常見祕密，但仍請避免在提示裡貼憑證。
- 真實驗收可重跑：`node tests/real-model/handoff-e2e.mjs <pi cli.js>`（只會建立並移除自己的專用 OpenCode 終端與 `E:Astra.astra-runshandoff-e2e` 下的合成專案；路徑寫在腳本開頭，請依機器調整）。

## 6. 已知限制（誠實清單）

- 安全防護是啟發式政策，不是 OS Sandbox（見 README 第 11 節）。
- Checkpoint 無法在多個 Agent 同時改同一個工作樹時分辨修改者；請用獨立 git worktree。
- 任務恢復恢復的是「任務」，不是 OS 程序；結果未知的有副作用操作由模型依證據判斷，無法由擴充功能保證。
- 自動交接是否不增加費用取決於你的聲明與接收者設定。
- LSP：TypeScript 的 `CLEAN` 來自 push 診斷，在極端情況下伺服器可能晚於逾時才回應，會得到 `INCONCLUSIVE` 而非錯誤的 `CLEAN`。C# 需要先 `dotnet restore`。Vue 檔案與其他語言沒有 LSP。
- Alt+M 在 TTY 才能使用；本專案以 Herdr 終端加 `hc keys alt+m` 驗證過，沒有人手按鍵的紀錄。
- Retry Limit 在模型一次送出平行呼叫時，同批已啟動的呼叫無法收回，保證的是停止後不再啟動新呼叫。
- CI（Windows runner）不含 Roslyn，C# LSP 只在有 VS Code C# 擴充功能的機器上驗證。
