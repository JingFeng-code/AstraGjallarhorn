# Pi 能力驗收

> 本文件前半是歷史驗收紀錄，其中的 BLOCKED／DEFERRED 描述的是當時狀態。**目前狀態以最後一節「v0.2 Release Closure」為準。**

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
| PASS | 正式 Pi 的真實本地模型在單行合成 SQL 遷移完成自主 Quality Gate。正常工具事件依序為 `bash` 執行 `node verify.mjs` 回傳 1、`read`、Better Edit `edit`、`bash` 重跑同一命令回傳 0。工具防護只容許合成檔案與該驗證命令。外層獨立再驗證回傳 0。 |
| BLOCKED | 模型 Runtime 故障的自主修復仍需完整 Playwright 驗收，包含模型自行取得故障、修復與重新執行。現有 Playwright 的故障注入已由共用腳本證實。 |
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

## v0.2 凍結驗收

| 必要能力 | 狀態與證據 |
|---|---|
| Foundation | PASS。Pi 1.6.0、模式、套件固定、備份／還原、同步、CI 與 RPC 回歸。 |
| pstack | PASS。architect 和 create-verification-skill 保留。correct 第三次以明確單行端點與完整原行指引，在實際 Better Edit 改好多行遷移的約束。獨立驗證回傳 0，並確認除錯誤值外未改內容。正確技能已正式同步及探索。 |
| Hashline、SQL／.NET／Vue Harness、Regression | PASS。保留正式 Better Edit 和第一方 Hashline 的已驗證路徑。CI 及正式 Pi RPC 各組回歸通過。 |
| 自主 Quality Gate、模型修復、Runtime | PASS，限已驗證 SQL 及 Vue 合成案例。Vue 的真實模型依序取得 Playwright 1、錨點讀取、錨點刪除注入的 console error、build 0、Playwright 0。 |
| TypeScript LSP | BLOCKED。已確認 Lens 的錯誤、定義與引用。仍需確定性診斷清除及退出清理，並限制未放行語言與執行期下載。 |
| C# LSP | BLOCKED。離線來賓的 Roslyn stdio 初始化、CS1525、.NET SDK 10.0.401 專案離線 restore 通過。Restore 首輪缺 reference packs，補齊後通過，但 pull diagnostics 未回報 CS0029。仍需確認 Roslyn 語意工作區和文件同步，再驗證 Pi 內的語意、導航與清除。 |
| Retry Limit、未知工具、Timeout、Cancel、子程序 | PASS，保留已有上限、退出碼及取消和清理證據。 |
| Context、Compaction、模型切換 | REPLACED，使用 Pi 原生功能。大型日誌保留及截斷、Session Compaction 摘要重開、原生模型選擇和復原已有驗收。 |
| 長任務恢復、Checkpoint | Session 摘要重新載入已驗證。手動 Git checkpoint 在合成工作樹逐位元組還原 tracked 及 untracked 內容。執行中背景工作恢復及 Pi 自動 Checkpoint 尚未驗收。 |
| 安全指令防護、自動 Herdr 交接 | BLOCKED。只有限定合成檔案及命令的測試政策，尚缺正式 Pi 可設定的通用防護。手動失敗摘要可用。自動交接需要已驗證的接收者選擇與隔離流程。 |
| Local／Cloud／Review、Plan Review、Diff Review | Profiles 已正式驗證。真實模型用提供的計畫與實際 Git diff 指出超過 40 字元和移除測試的問題，檔案雜湊未改。模型自行擷取 diff 的原先測試反覆呼叫未允許命令，已中止；自動擷取尚未放行。 |
| 模型 A/B | PASS，保留上一輪真實本地模型單次配對及 PR 的原生／Better Edit 資料。 |

發布結論：Draft PR 可供評審。必要 LSP、正式安全政策及自動交接尚未具備放行證據，v0.2 不標為完整。

## v0.2 Release Closure

2026-11-26，Windows 11、Pi 1.6.0、Node 24.18.0、PowerShell 7.7、.NET SDK 10.0.401、Microsoft C# 擴充功能 2.160.4。接手後新增的實作在 commit 範圍 `83d22ac`…本節所在 commit。證據分三層，分開記錄：

1. **確定性功能測試**：`node --test tests/*.test.mjs`，166 項，設定 `ASTRA_TSLS` 後全部通過（含真實 typescript-language-server 與 Roslyn）；未設定時 TypeScript 伺服器測試略過。
2. **真實 Pi 工具調度**：真實 Pi 1.6.0 RPC 程序，模型回應由腳本化提供者依序回傳，驗證工具事件、攔截、日誌與程序清理。八個入口（mode、retry-limit、command-guard、checkpoint、handoff、task-recovery、diff-review、lsp）全部通過，`tests/sync.ps1` 通過。
3. **真實模型任務**：本地 Ollama `mimo-v2.6-agent32k`（先在隔離 agent 目錄，再在已安裝的正式 Pi），以及使用者既有訂閱的 `deepseek-v4.1-flash:cloud`（沒有新增費用）。原始輸出在 [evidence/](evidence/)。成功判定一律由 Pi 外部獨立執行 `tsc`、`dotnet build`、`git status`，不以模型自述為準。

### 逐項判定

| 必要能力 | 判定 | 證據與限制 |
|---|---|---|
| A. TypeScript LSP | **PASS** | `typescript-language-server@6.1.0` + `typescript@5.9.3`（兩個套件、零依賴、audit 0）。診斷 TS2322 → 修正後伺服器明確回報空清單 `CLEAN`（不是 inconclusive）；定義、跨檔引用；文件從磁碟同步（版本 +1）；Pi 結束與 `/lsp stop` 後程序消失；工具來源不含 fetch／npm／nuget 安裝路徑（靜態測試），`disableAutomaticTypingAcquisition`。Pi 調度與真實模型（隔離 29 秒、正式 12–47 秒）均通過，獨立 `tsc` 回傳 0。 |
| B. C# LSP | **PASS（限有 VS Code C# 擴充功能的機器）** | Microsoft Roslyn Language Server（Authenticode 有效）。`project/open` 載入專案約 2.6 秒；pull 診斷 CS0029 出現、修正後清除；定義、跨檔引用；文件同步；`workspace/configuration` 關閉自動 restore（沒有 restore 產物的專案不會被隱式還原）；Roslyn 與 BuildHost 程序在結束後歸零。語意診斷不到的原因（先前缺少專案載入）已解決。真實模型：隔離 21–28 秒、正式 + 雲端模型 13–16 秒，獨立 `dotnet build` 回傳 0。**限制**：CI runner 沒有 Roslyn，僅在本機驗證；`dotnet restore` 須先完成。 |
| C. 背景任務恢復 | **PASS** | 任務日誌（提示、每個呼叫、擁有者 pid）。真實 Pi 被 `taskkill /F` 殺死於執行中的呼叫後，新 Pi 偵測到「1 個完成、1 個結果未知」，`/task resume` 產生的提示包含已完成清單與「可能已改變狀態」標示並禁止盲目重跑；第二次續接被拒，沒有重複派工；鎖防止並行續接；逾時取消後任務為 `timeout`、沒有殘留子程序；孤兒程序報告（確認後才終止）。恢復的是任務而不是 OS 程序。 |
| D. 自動 Checkpoint | **PASS** | 每個任務前後自動快照（tracked + untracked，遵守 .gitignore），不改 index／HEAD／stash／檔案（測試逐項比對）。還原預覽、只還原任務改變的路徑、任務後被外部修改的檔案 SKIP、其他 Agent 的檔案不碰、還原到任務開始前（含當時未提交修改）而不是 HEAD、還原前自動安全快照。偵測任務間的外部修改、偵測同一工作樹內另一個活躍 Pi 並建議 `/checkpoint isolate` 建立獨立 git worktree。限制：同一工作樹內同時作業的 Agent 無法被分辨。 |
| E. 安全指令防護 | **PASS（啟發式，非 OS Sandbox）** | 141 條指令語料（允許 47、需核准 51、拒絕 43）加檔案工具與解析器測試，涵蓋：授權目錄外寫入／刪除、破壞性 git、大量刪除、憑證、其他 Agent 設定、Pi 自身設定、全域安裝、系統設定、`bash -c`／`eval`／`-EncodedCommand`／`$()`／管線／`cd` 後相對路徑／`Start-Process` 間接執行、`curl | sh`，以及正常 build／test／lint 不被擋。真實 Pi：破壞性 git 被拒後未提交修改保留；人工核准後放行；外部寫入與憑證讀取拒絕。真實模型（正式 Pi）要求執行 `git reset --hard` 被攔下且檔案保留；真實模型在防護開啟下完成 SQL 修復迴圈，0 次誤攔。限制見 README 第 11 節。 |
| F. Herdr 自動交接 | **PASS（預設關閉）** | 第三次失敗後 retry-limit 停止並發出事件；`handoff.js` 檢查接收者存在、活著、閒置、工作目錄相同、Agent 種類未被更換、不是自己；寫摘要檔；透過 `hc send --if idle` 送一行短指令；確認接收者狀態變 working 或 turn 增加；送出失敗或未確認都保留摘要並停止，不重試；帳本與標記防止重複與循環，每小時上限 3 次。真實 Pi 對腳本化假 `hc` 驗證，假 hc 回傳與真實 `hc get --json` 相同欄位（`status.state`、`status.app`、`cwd`、`turn`、`labels`）。**未對真實 OpenCode 工作階段送出交接**：避免打擾使用者現有的 Agent；對真實 hc 只做了唯讀的 `hc get --json` 欄位核對。 |
| G. Diff Review | **PASS** | 唯讀 `review_diff`：固定的 git 讀取命令，staged／unstaged／untracked、範圍報告（缺少回歸測試、部分暫存）、工作樹指紋前後比對。真實 Pi 調度與真實模型（隔離 17 秒；正式 Pi 15–29 秒）自行取得 diff，指出測試缺口，工作樹逐位元組未變。模型是否正確抓到所有架構違規屬模型能力：本地模型未讀取 untracked 檔案，已在報告中如實保留。 |

### 真實模型紀錄（僅新增能力，單次，不推論普遍效能）

| 情境 | 模型 | 工具序列 | 結果 |
|---|---|---|---|
| TypeScript LSP，隔離 | mimo-v2.6-agent32k | lsp_diagnostics → read×5（4 次誤用路徑）→ edit → lsp_diagnostics | CLEAN；獨立 tsc 0；29 秒 |
| C# LSP，隔離（首次，模型直接讀檔略過 LSP） | mimo-v2.6-agent32k | read → edit → lsp_diagnostics | 未證明 LSP 偵錯，改寫提示 |
| C# LSP，隔離（不讀檔） | mimo-v2.6-agent32k | lsp_diagnostics×3 → read → edit → lsp_diagnostics | 看到 CS0029，CLEAN；獨立 build 0；21 秒 |
| Diff Review，隔離 | mimo-v2.6-agent32k | read → review_diff | 指出測試缺口；工作樹未變；17 秒 |
| Guard 正常迴圈，隔離 | mimo-v2.6-agent32k | bash、bash、edit、bash、bash | 0 次誤攔；驗證 0；24 秒 |
| 正式 Pi 清單 | — | — | 十個指令全部可探索 |
| 正式 Pi，guard + checkpoint | mimo-v2.6-agent32k | bash(被攔) | 檔案保留；2 個 checkpoint refs；13 秒 |
| 正式 Pi，TypeScript LSP | mimo-v2.6-agent32k | 7 個呼叫 | CLEAN；獨立 tsc 0；47 秒（含一次 edit 失敗後重試） |
| 正式 Pi，Diff Review | mimo-v2.6-agent32k | review_diff | 工作樹未變；29 秒 |
| 正式 Pi，C# LSP | mimo-v2.6-agent32k（兩次） | 反覆 `read` 誤用參數名；第二次 Better Edit 多行錨點破壞檔案（13 個診斷） | **未通過**。LSP 正確回報破壞後的錯誤；失敗原因是本地模型與 Better Edit 工具形狀，與既有紀錄一致 |
| 正式 Pi，C# LSP | deepseek-v4.1-flash:cloud | lsp_diagnostics×3 → read → edit → lsp_diagnostics | CLEAN；獨立 build 0；16 秒 |
| 正式 Pi，全部情境 | deepseek-v4.1-flash:cloud | 見 [formal-pi-cloud-model.json](evidence/formal-pi-cloud-model.json) | inventory、LSP×2、Diff Review 通過；guard 情境中模型自行拒絕執行破壞性命令（檔案保留，防護未被觸發），該情境以 mimo 結果為準 |

同一失敗原因（本地模型經 Better Edit 修改 C# 檔案）已有三次新證據的嘗試：原生工具通過、Better Edit 兩次失敗、更換為訂閱雲端模型通過，之後不再重複。這表示：本地小模型不應配 Better Edit 做多行 C# 修改；此限制屬於模型，不屬於 LSP 擴充功能。

### 正式安裝

使用 `scripts/apply.ps1 -StrictVersion`：第一次 dry-run 為新增 6、更新 2、相同 22、衝突 0；備份後寫入 8 個檔案。`typescript` 與 `typescript-language-server` 以固定版本安裝在 `~/.pi/agent/lsp`。後續修正（LSP 顯示原始碼行、Checkpoint 多 Agent 偵測、防護 `Start-Process`）再次 dry-run（更新 3、衝突 0）並備份後套用。`scripts/verify.ps1`：16 PASS、0 FAIL、0 WARN、1 MANUAL（Alt+M 需要 TTY）。

保護範圍：Pi 的 `auth.json`、`models.json`、`models-store.json`、`mode-state.json`、`mcp.json`、`astra-herdr.js`、`mode-switch.ts`、`hashline.js` 以及 `~/.codex`、`~/.config/opencode`、`~/.config/herdr-core`、AstraAegis 的雜湊與 HEAD 在安裝前後比對，結果如下。

### 保護檔案比對

安裝前後對 7,083 個保護檔案做 SHA-256 比對：7,064 個一致，19 個不同。

- Pi：`auth.json`、`models.json`、`mode-state.json`、`mcp.json`、`astra-herdr.js`、`mode-switch.ts`、`hashline.js` 全部一致。唯一不同的 Pi 檔案是 `models-store.json`（Provider 模型快取）：驗收時啟動正式 Pi 程序，Pi 自己重新整理了這份快取，不是本專案寫入，內容不含偏好設定。
- Codex：18 個不同的檔案是正在執行的 Codex 的資料庫、鎖、socket、`models_cache.json` 與外掛暫存檔。這些檔案被 Codex 程序佔用並持續寫入；本輪沒有對它們寫入。
- OpenCode、Herdr 設定、AstraAegis：全部一致；AstraAegis HEAD 仍為 `732aafec`，工作樹乾淨。

### v0.2 判定

七項必要能力均有實際證據，沒有因阻塞而延後的必要功能。限制已如實列於上表與操作手冊第 6 節。本分支標記為 **v0.2 RELEASE READY**，待人工審查 Draft PR 與 CI；未合併 main、未建立 Release。

## v0.2 Final Release Acceptance

2026-11-26，commit `91adc2c` 之後的最終驗收。功能凍結，只做真實交接驗收、程式碼審查修正與最終交付核對。

### 1. 真實 Herdr 自動交接

[原始輸出](evidence/real-handoff-e2e.json)。使用正式 Pi（真實本地模型 `mimo-v2.6-agent32k`）、真實 `hc`、專用 OpenCode 接收終端（`opencode --standalone --auto`，模型由合成專案內的 `opencode.json` 指定為本地 `ollama/mimo-v2.6-agent32k:latest`，沒有改動 OpenCode 全域設定，不產生雲端費用）。每個情境各自建立合成專案與專用終端，沒有使用任何人正在工作的 Agent。

| 情境 | 結果 |
|---|---|
| 正常交接 | Pi 的 `node verify.mjs` 失敗，`/retry-limit on` 在第三次相同失敗後停止（停止後沒有任何新工具呼叫啟動）。交接摘要寫入 `~/.pi/agent/handoffs/`；真實 `hc send --if idle` 送出一行短指令；接收者由 idle 變 working；OpenCode 讀取摘要，把 `notes.txt` 補成 3 行，獨立執行 `node verify.mjs` 回傳 0，接收者回到 idle（turn 1）。帳本只有 1 筆 `received`，接收者螢幕上只出現 1 次交接訊息：沒有重複派工，也沒有循環交接。 |
| 接收者忙碌 | `Handoff failed: receiver is working, not idle`。沒有任何文字被打進忙碌的終端，接收者 turn 不變，摘要保留。 |
| 接收者不存在 | `Handoff failed: receiver … not found`（真實 `hc` 回報 `not_found`）。摘要保留，不重試。 |
| 預設關閉 | 新的正式 Pi 工作階段 `/handoff-auto status` 為 off，`~/.pi/agent` 內沒有任何持久的交接設定檔。 |
| 清理 | 測試結束後所有專用接收終端已移除；`hc ls` 只剩使用者自己的終端。 |

過程中的發現（如實記錄）：
- 模型在平行批次中可能已同時啟動第 4 個呼叫，Retry Limit 停止時它已在執行。驗收條件因此是「停止後沒有新呼叫啟動」，而不是「恰好 3 次」。
- 早期一輪的提示讓模型只失敗 2 次，沒有觸發上限，已改成固定提示。
- 反覆重跑測試用完了正式帳本的「每小時最多 3 次」上限，之後的交接被正確擋下（`handoff cap of 3 per hour reached`）。這證明上限有效；為了繼續驗收，測試產生的帳本被改名備份為 `ledger.json.bak-<時間戳>`（只動測試自己留下的檔案）。

### 2. 最終程式碼與安全審查

審查本 PR 新增的擴充功能，只修實際缺陷：

| 檔案 | 缺陷 | 修正與測試 |
|---|---|---|
| `handoff.js` | 摘要與送出內容沒有遮罩祕密 | `redact()` 遮蓋 Bearer／Basic、`sk-`、GitHub／AWS／Slack 金鑰、JWT、URL 帳密、`password=`／`--token`、私鑰區塊；測試涵蓋九種樣式並確認一般指令不受影響 |
| `handoff.js` | 帳本是無鎖的讀改寫，兩個 Pi 同時觸發可能都送出；寫入後的狀態更新還會覆蓋別人的紀錄 | 互斥鎖檔（死亡程序與逾時鎖會被接管）加原子寫入；先在鎖內「認領」失敗再送出；同一接收者 2 分鐘內有「送出中」不再送；測試：四個並行呼叫只送一次、三個不同失敗不並行送出、帳本無遺失或重複 |
| `command-guard.js` | `cd <授權目錄外> && git commit` 被放行（相對路徑 git 寫入沒有檢查目前目錄）；`git branch <name>` 被當成唯讀 | git 寫入一律檢查實際作用的儲存庫（`-C` 或目前目錄）；只有純列表形式才算唯讀；新增三項拒絕測試 |
| `checkpoint.js` | 還原時若某個舊版本讀不到（例如巢狀儲存庫的 gitlink），可能做到一半 | 先讀完全部舊版本才寫入，讀不到就整批不動並指向安全快照 |
| `task-recovery.js` | `git branch -D`、`git remote add` 被歸類為唯讀，續接時可能被當成可安全重做 | 只有純列表才是唯讀；新增測試 |
| `lsp.js` | Pi 結束時的子程序清理寫在非同步回呼裡，程序退出時不會執行 | 改為同步 kill；Roslyn 另有 `--clientProcessId` 自行結束 |

審查後保留、已記入文件的已知邊界：防護不分析腳本檔內容（`node script.js`）、變數展開與別名；摘要遮罩是樣式比對；Checkpoint 無法在同一工作樹分辨多個同時修改的 Agent；任務日誌存放原始提示，與 Pi Session 檔相同，只在本機。

### 3. 最終交付核對

| 項目 | 結果 |
|---|---|
| 正式 Pi 與 GitHub | 正式 Pi 的擴充功能檔與本分支同一份清單以 `verify.ps1` 逐檔雜湊比對：17 PASS、0 FAIL、0 WARN、1 MANUAL。 |
| Alt+M | 在 Herdr 終端（真實 TTY）開啟正式 Pi，以 `hc keys alt+m` 送出：第一次後 Skills 清單不再含 `ds-*`，第二次後 `ds-*` 回來；`mode-state.json` 未變。注意這是經 hc 送鍵，不是手按。 |
| 跨機安裝手冊 | `docs/operations-manual.md` 第 2、3 節；`apply.ps1` Dry Run 與備份為前置步驟。 |
| Roslyn 與固定版本 | `manifests/packages.json` 記錄 `ms-dotnettools.csharp 2.160.4`、伺服器 5.12.0-1.26452.1、DLL SHA-256 與 Microsoft 簽章者、.NET SDK 10.0.401；`verify.ps1` 檢查簽章有效並比對已測雜湊（版本不同為 WARN，簽章無效為 FAIL）；TypeScript 伺服器固定 typescript 5.9.3、typescript-language-server 6.1.0。 |
| 備份與還原 | `apply.ps1 -Restore -RestoreLatest` 預覽列出正確的待還原檔案（本輪實測）；實際還原與衝突保護由隔離的 `tests/sync.ps1` 驗證（通過）。沒有對正式 Pi 做實際還原。 |
| 費用 | 本輪只使用本地 Ollama（`mimo-v2.6-agent32k`）與先前已確認的既有訂閱模型；OpenCode 以專案內設定固定使用本地模型。沒有新增套件、付費服務或帳號。 |
| 其他 Agent 設定 | 見下。 |

### 保護檔案比對（最終）

OpenCode 全域設定沒有被修改：本輪只在合成專案目錄放 `opencode.json`。Pi 的 `auth.json`、`models.json`、`mode-state.json`、`mcp.json`、`astra-herdr.js`、`mode-switch.ts` 與 `hashline.js` 的雜湊與接手時一致。其餘結果見前一節「保護檔案比對」。

### 判定

七項必要能力與最終驗收項目均有實際證據，沒有因阻塞而延後的必要功能。本分支標記為 **v0.2 RELEASE READY**（待 CI 在最新 commit 全綠、人工審查 Draft PR）。未合併 main、未建立 Release、未刪除分支。
