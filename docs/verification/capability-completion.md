# Pi 能力驗收

Windows、Pi 1.6.0、Node 24.18.0。正式 `/verify` 使用已同步的提示。根目錄的 `scripts/verify-project.ps1` 可由 Pi 的 `!`、RPC bash 或 PowerShell 直接執行。CI 對 SQL、.NET、Vue 分別呼叫同一腳本，第一個失敗的退出碼會傳回給執行端。

## 本輪實測

| 檢查 | 證據 |
|---|---|
| Pi 隔離 RPC | SQL、.NET、Vue 共用入口均通過。將長度上限放寬、C# 回傳型別改錯及新增無效 HTTP 資源，各自回傳 1 並給出預期診斷。還原後各自回傳 0。 |
| 正式 Pi RPC | 三組基線均回傳 0，未發送模型請求。 |
| 瀏覽器 | Playwright 驗證表單結果、console error、未捕捉例外及 HTTP 4xx／5xx。合成缺少資源的 JSON 請求回傳 404，使驗證失敗。 |
| Tree | Windows TTY 從合成分支 10000004 切至 10000003，選擇不摘要。切換及 /reload 後仍為 Deep Execution、7 個 ds Skills。 |
| Herdr | 隔離 Pi 使用本機 Ollama，觀察到 `idle → working → done`。模型反覆請求未開放工具，按 Esc 中止後，Pi 顯示 `Operation aborted` 並回報 `done`。此回報表示回合結束。 |
| 原生輸出管理 | RPC bash 收到 260,000 位元組的完整日誌，回應限制為 51,200 位元組。此呼叫設定 `excludeFromContext: true`，可從 RPC 回應的 `fullOutputPath` 取回完整輸出。未測模型 compaction 或 Token 節省。 |
| 同步與還原 | 正式 dry-run 只列出 `agent/prompts/verify.md`，實際套用亦只寫入該檔。正式 verify 為 15 PASS、0 FAIL、1 MANUAL。隔離同步及還原回歸通過。 |

`/verify` 的三次重跑上限與 Herdr 摘要屬提示層。使用既有 Herdr 工作流程手動交接時，摘要應包含重現命令、最近退出碼、改過的檔案及下一個有證據的檢查。Windows CI 以實際退出碼判定工作是否成功。

## 插件放行

本輪新增的工程能力採用 Pi 原生 RPC、提示與既有 Playwright。npm 候選發行物僅下載及靜態檢視，擴充功能程式碼沒有執行。依賴鎖定為隔離目錄的解析快照，排除了 peer 安裝且停用 lifecycle。

| 候選 | 結果 |
|---|---|
| pi-better-edit 2.21.0 | npm 發行物與上游標籤已識別。標籤為 `b89f5cf2`，發布包包含打包後的入口，尚未完成可重現建置比對。解析出 15 個鎖檔項目，尚待逐項安全審查。Hashline、過期讀取及並行保護未放行。 |
| pi-lens 4.5.2 | npm gitHead 與上游標籤均為 `dfdd854e`。解析出 32 個鎖檔項目，含 ast-grep CLI 安裝腳本及 Windows 原生元件。上游 prepare 有 grammar 下載和 Git hooks 步驟，尚未驗收執行期下載與 LSP 相容性。 |
| context-mode 2.2.3 | Node 版本相容，鎖檔沒有另列 npm 執行期相依。CLI 與 Pi 擴充入口仍需完整審查。原生 RPC 的大型輸出控制已通過單項測試。 |
| pi-verify、@wengine-ai/pi-quality-gates | pi-verify 來源仍待核對。Quality Gates 0.3.0 的發布入口註冊 `tool_call`、`tool_result`、`agent_before_settle` 等 hooks。採用可直接執行的共用腳本與 CI，現有流程無需攔截其他工具。 |

未完成 Hashline、LSP、其他 pstack 技能、插件或模型 A/B，以及由模型自主修復的驗收。正式技能仍含已驗證的 `architect` 和原有 DeepSeek Skills。其餘候選工具未執行。
