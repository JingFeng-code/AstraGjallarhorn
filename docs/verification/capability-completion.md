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

## Windows Sandbox 實測續記

2026-11-26，`WindowsSandbox.exe` 啟動成功。來賓以 `wdagutilityaccount` 執行驗證，回報 Windows `10.0.26100.9974`。非系統管理員終端執行 DISM 查詢回傳 740。功能狀態以使用者確認及實際來賓執行為據。測試關閉網路和剪貼簿，輸入唯讀，證據另寫入空白目錄。正式安裝流程無 Sandbox 相依。

| 檢查 | 觀察 |
|---|---|
| 依賴 | 在暫存目錄以既有鎖檔停用生命週期腳本準備候選依賴。Registry audit 在兩個解析圖中均回報 0 筆已知漏洞；這項結果只涵蓋該次解析和 registry 資料。 |
| pi-better-edit 2.21.0 | 以 Pi 1.6.0 在真正 Windows 來賓載入，實際執行插件的 `read` 和 `edit`。行錨點能替換指定行，保留 CRLF。測試外部修改後收到 `E_TARGET_LOST`，並確認修改仍在。 |
| pi-lens 4.5.2 | 在同一來賓中，以 TypeScript 5.9.3 及 typescript-language-server 6.1.0 實測。`lens_diagnostics` 回報注入的 TS2322。`lsp_navigation` 回報第 1 行定義與第 2 行引用。修正後獨立 `tsc --noEmit` 回傳 0；LSP 因 server 對乾淨檔案未發布清除證據而回報 inconclusive。 |
| 組合 | 兩套件在同一個 Pi 程序註冊並實際執行工具定義。行錨替換、過期拒寫和 TS2322 均通過。此探針直接呼叫工具定義，模型工具調度和 hooks 全流程另待確認。 |
| C# Roslyn | 來賓用 .NET 10.0.12 啟動既有 Microsoft Roslyn server 的 `--help`，確認提供 stdio 模式。Lens 探針未回報注入的語法錯誤，結果為 inconclusive。另觀察到 Lens 在缺少 C# tree-sitter grammar 時嘗試下載，離線環境中下載失敗。 |

兩個套件的 Windows 啟動、直接工具功能與組合同時載入已實證。模型工具整合、C# LSP、Lens 的執行期下載控制及正式設定受影響範圍仍待放行。保留既有第一方 Hashline；候選 `pi-better-edit` 會覆寫模型的 `read`／`edit`，其覆寫與正式 Pi 其他擴充的交互作用尚無證據。這次候選程式碼只在來賓執行。

## 正常工具調度與重試上限

- Better Edit 2.21.0 在離線 Sandbox 由本機串流測試提供者驅動 Pi 正常工具調度。`read → edit（過期拒寫）→ read → edit` 四個工具事件與檔案內容均符合預期。同一實例也載入第一方 mode-switch、Hashline 與 tool-profile。此實測不含真實 Ollama 模型、所有正式擴充、Deep Execution 切換或完整工具設定驗收。
- 第一方 `/retry-limit` 預設關閉。最初只監聽 `tool_result` 會漏掉不存在工具的錯誤。改用工具執行事件後，隔離與正式安裝檔副本的 Pi 1.6.0 測試均在第 3 次相同失敗中止，涵蓋 `read` 讀取不存在檔案及不存在工具兩種案例，測試提供者皆未收到第 4 次請求。單元測試另驗證預設關閉、成功清除相同錯誤計數及新回合重置。Herdr 自動交接未驗收。

## Release Gate Closure

| 狀態 | 驗收及解除條件 |
|---|---|
| PASS | Better Edit 2.21.0 已正式安裝。去除認證的 Sandbox 副本包含正式擴充、Skill、Pi 套件入口及 Deep Execution 設定。腳本式調度和三種 profile 切換通過。真實 Ollama 模型透過只能轉交固定本地模型的檔案中繼，在無網路來賓取得錨點，完成過期拒寫、重讀及編輯。正式 Pi 獨立 Session 使用實際安裝的套件完成單行錨點修復。中繼僅供測試，正式 Pi 無中繼或 Sandbox 相依。 |
| PASS | pstack 的精簡 Pi 版 `create-verification-skill` 已同步。首次草稿使用了絕對路徑。修正指引後，模型產出可攜 Markdown，Pi 可探索生成的 skill，原樣命令在合成例得到退出碼 0、1、0。生成 command 的故障及還原由獨立驗收驅動。 |
| REPLACED | Pi 原生 Compaction 的 Session 行為已驗證。測試提供者回傳摘要，原生 RPC 估計 Token 由 9,280 降至 649，新 Pi 程序重新開啟同一 Session 後仍讀到摘要。這項證據涵蓋 Session 續接，執行中的背景程序恢復及真實摘要品質另計。原生 `set_model` 在隔離目錄成功選到第二模型及切回，未呼叫模型或更改正式偏好。 |
| BLOCKED | Lens 的 TypeScript 仍需要能明確回報清除的 LSP 與結束清理證據。C# 需要 Roslyn 工作區載入、離線固定 grammar 和語法、型別、定義、引用回歸。正式放行還需要驗證未放行語言及下載可停用。 |
| BLOCKED | `correct` 使用原生工具可完成 SQL 修復，與正式 Better Edit 工具形狀組合時，兩次模型都改壞鄰行，分別在 PRAGMA 或 title 附近出現語法錯誤。解除條件是同一回歸的模型輸出只改目標行並通過驗證。 |
| BLOCKED | 自主 Quality Gate 與模型 Runtime 的連續操作需要真實模型完成執行、取得退出碼、修正、重跑的單趟證據。目前可重現的 SQL 修復使用外層獨立驗證，Playwright 已能偵測故障。 |
| BLOCKED | 仍缺已驗證的背景程序續跑、任務 Checkpoint、通用安全指令政策、Plan／Diff Review 與自動 Herdr 交接。正式設定的備份還原與手動停止摘要維持可用。 |
| DEFERRED | Context Mode 的合成索引與搜尋仍有 Sandbox 證據。這版先使用已驗證的原生 Compaction。候選的執行期攔截與索引資料恢復未取得足以支持正式安裝的證據。 |

### 真實模型單次配對

三組均為本地 `mimo-v2.6-agent32k:latest`，每組內固定工具防護、模型、故障輸入和驗收。Token 為 Pi 逐模型回應統計的合計，快取讀取另列。耗時包含啟動與快取差異，單次數據不推論普遍效能。

| A/B | A | B |
|---|---|---|
| Retry Limit off／on | 2 次失敗讀取，自行停止，15.44 秒。input/output/cacheRead 891/53/781。 | 2 次失敗讀取，自行停止，5.01 秒。657/56/1019。兩邊均未觸發第 3 次上限。 |
| Local／Review | 讀取與修改各一次，驗證 0，9.10 秒。678/137/2994。 | 59 次呼叫，其中 1 次未開放編輯失敗，其餘重讀。120 秒終止，驗證 1。2334/2173/161737。Review 保持檔案不變。 |
| 無驗證診斷／提供既有失敗診斷 | 各一次讀取與修改，驗證 0，13.20 秒。769/231/3078。 | 3 次呼叫含 1 次讀取失敗，驗證 0，16.43 秒。799/315/3251。這個案例未觀察到導入診斷能減少呼叫。 |

Tool Profile 首輪的單檔防護只接受相對字串，誤拒合成檔案的絕對路徑。改為正規化後限定同一個檔案，再重跑兩組。Better Edit 的真實工具整合另有實機證據，與上述配對所測的變因不同。
