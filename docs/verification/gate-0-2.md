# AstraGjallarhorn 首輪驗證紀錄

2026-11-25（Asia/Taipei）

| Gate | 狀態 | 目前證據 |
|---|---|---|
| 0 現況 | FAIL | GitHub 基線及本機設定已盤點。Pi 1.6.0 超出 main 宣告的 1.5.x，版本比對回傳 1。本機 checkout、模型能力與各項回歸仍待查驗。 |
| 1 pstack | NOT TESTED | 已讀取上游與移植案原始碼及中繼資料，提出最小導入範圍。Windows、實際載入及跨技能相容性尚未驗證。 |
| 2 插件選型 | BLOCKED | 已取得部分固定候選版本。尚缺等版本發行檔、相依與安裝行為審查，以及受限測試環境。 |
| 3–8 | NOT TESTED | 已制定測試矩陣。尚未進行插件 A/B、實作或部署。 |

## 本機與 GitHub 基線

- PowerShell 7.6.9、Windows NT 10.0.26300.0、Node 24.14.0、npm 11.9.0、Herdr Desktop 0.1.18、hc 0.1.22。從已安裝的 package.json 讀得 Pi 1.6.0、pi-agnes-tools 0.3.7、pi-ollama-cloud 0.13.1。本機 settings 的兩筆 npm 套件來源皆未附版本。Ollama CLI 未在命令搜尋結果中，模型清單、Context、工具呼叫能力、認證有效性及 Cloud 成本均為 NOT TESTED。
- GitHub 連線確認專案為私有，預設分支 main 指向 `cf0f5248562ca3d061229ec0aa8d2f9b658227e4`。另外有 `brand/astra-mythos-20261119` 與 `docs/astra-mythos-artifacts-20261120`。PR #1 與 #2 均已合併。未建立開發分支、commit 或 PR。專案名稱搜尋及本機 Git remote 檢查未定位既有 checkout，這個工作區的 `git rev-parse --is-inside-work-tree` 回傳 128。終端 `git ls-remote` 回傳 1，診斷為 GitHub DNS 解析失敗。透過 GitHub 連線取得固定 commit 的樹及指定原始碼。[main](https://github.com/JingFeng-code/AstraGjallarhorn/tree/cf0f5248562ca3d061229ec0aa8d2f9b658227e4) · [分支](https://github.com/JingFeng-code/AstraGjallarhorn/branches) · [PR #1](https://github.com/JingFeng-code/AstraGjallarhorn/pull/1) · [PR #2](https://github.com/JingFeng-code/AstraGjallarhorn/pull/2)
- 本機 `~/.pi/agent` 可見 `mode-switch.ts`、`commit.md`、`review.md`、`verify.md` 與 24 個 Skills 目錄。另有 `~/.pi/skills` 與 Deep Execution 的七個 `ds-*` Skills。是否被其他 Agent 發現需由各 Agent 的有效掃描設定確認，資料夾位置只能證明檔案所在。

## 原始碼盤點與技術債

| 檢查 | 發現與證據 |
|---|---|
| 版本與 Provider | manifest 宣告 Pi 1.5.2／1.5.x 與上述兩個 npm pin。verify 依套件名稱比對設定，再比實際安裝版本，故可通過未釘選的 settings 宣告。apply 保留已存在的來源項目，僅替缺項補 pin。providers manifest 記錄 `ollama-cloud`，實際服務連線 NOT TESTED。[套件清單](https://github.com/JingFeng-code/AstraGjallarhorn/blob/main/manifests/packages.json) · [verify](https://github.com/JingFeng-code/AstraGjallarhorn/blob/main/scripts/verify.ps1#L182-L202) · [apply](https://github.com/JingFeng-code/AstraGjallarhorn/blob/main/scripts/apply.ps1#L241-L272) |
| 模式 | Alt+M 走 `/mode use` 與 reload。模式讀寫使用共用 agent 目錄的 `mode-state.json`。資源發現與每輪提示各自再讀取，因而可能出現 A/B Session 互相影響、已載入技能與新一輪指令不同步。直接覆寫檔案另有並行及讀到不完整 JSON 的風險。Deep Execution 的資源基底另取自 `homedir()/.pi/modes`，單設 `PI_CODING_AGENT_DIR` 仍可指向正式模式資源。以上是程式碼觀察，雙 TUI 行為 NOT TESTED。[模式切換](https://github.com/JingFeng-code/AstraGjallarhorn/blob/main/extensions/mode-switch.ts#L20-L56) |
| 既有驗證 | verify 有版本檢查、套件清單、Skills、快捷鍵註冊原始碼檢查和 Pi RPC 模式樣本。RPC 樣本使用個別暫存 agent 目錄，需另加同一 agent 目錄的雙 Session 回歸。快捷鍵字串檢查仍需 TUI 實測。[verify](https://github.com/JingFeng-code/AstraGjallarhorn/blob/main/scripts/verify.ps1) |
| 匯出、備份與還原 | export 按同步清單 staging，正式匯出可覆寫或移除對應 repo 路徑。讀不到套件版號時會產生 `@unknown` pin。apply 有預覽、備份與還原。備份包含本機 settings，還原會整檔覆寫，亦會清除當時不存在的受管檔案。正式執行前應以合成設定做漂移、半途失敗以及還原期間使用者新修改的案例。[export](https://github.com/JingFeng-code/AstraGjallarhorn/blob/main/scripts/export.ps1) · [apply](https://github.com/JingFeng-code/AstraGjallarhorn/blob/main/scripts/apply.ps1) · [同步清單](https://github.com/JingFeng-code/AstraGjallarhorn/blob/main/manifests/pi-config.json) |
| 文件 | README 第 5 行仍指稱 GitHub repo 為 AstraRelay，安裝範例仍有 pi-config clone 路徑。同步清單及備份名稱也使用 pi-config，改文件時應保留仍有效的實際路徑。[README](https://github.com/JingFeng-code/AstraGjallarhorn/blob/main/README.md) |
| Herdr | AstraAegis 的 installer 將 `runtime/pi-global-extension.js` 部署成 `astra-herdr.js`。入口以 `HC_TERMINAL_ID` 判定是否在 Herdr 終端，轉接 runtime bridge。另有 Pi runtime 在 session、模型選擇與 agent 事件發送狀態。此次本機已掃描的 Pi extension 目錄未見該檔。實際回報、替代安裝位置與可重用失敗交接尚未證實。[installer](https://github.com/JingFeng-code/AstraAegis/blob/c77fef134a94c9f47976ef91bab65dd31eb7f27d/home/mods/astra-studio-kit/install-pi-extension.ps1) · [bridge 入口](https://github.com/JingFeng-code/AstraAegis/blob/c77fef134a94c9f47976ef91bab65dd31eb7f27d/home/mods/astra-studio-kit/runtime/pi-global-extension.js) · [Pi runtime](https://github.com/JingFeng-code/AstraAegis/blob/c77fef134a94c9f47976ef91bab65dd31eb7f27d/home/mods/astra-studio-kit/runtime/pi.js) |

Pi 官方文件列出 `~/.agents/skills` 與專案祖先目錄的 `.agents/skills` 為探索來源。無插件基線也需隔離共用技能。個別 pstack 技能可保留明確呼叫屬性，或透過 Pi 資源篩選僅載入指定 Skills，將 extensions 設為空清單。[Pi Skills](https://docs.pi.dev/latest/skills) · [Pi Packages](https://docs.pi.dev/latest/packages)

## pstack 比較與決策

| 來源 | 觀察到的版本與行為 | 決策 |
|---|---|---|
| Cursor 官方 | Lauren Tan，MIT。上游 main manifest 顯示 0.15.48。可取得九個指定的 SKILL.md，皆標為明確呼叫。Cursor 的 orchestration 和外部工具仍需在 Pi 做調整。[manifest](https://raw.githubusercontent.com/cursor/plugins/main/pstack/.cursor-plugin/plugin.json) · [技能](https://github.com/cursor/plugins/tree/main/pstack/skills) · [演講頁](https://www.youtube.com/watch?v=O_zcc6Xl12g) | 以原始來源選取個別技能，移植前鎖 commit 並保留 MIT。演講頁已辨識，未據此聲稱講稿內容。 |
| backnotprop | 同步鏡像，改寫部分 harness 指令。鏡像可讀到 0.15.36，與上游所見快照有差異。[MIRROR](https://github.com/backnotprop/pstack/blob/main/MIRROR.md) · [manifest](https://github.com/backnotprop/pstack/blob/main/.cursor-plugin/plugin.json) | 可供比較。共用安裝器 DEFERRED。 |
| jiangkoumo | main manifest 0.3.13，MIT，Node ≥22.19，Pi peer 無版本下限，包含 writer review gate 及可選 pi-subagents。[manifest](https://raw.githubusercontent.com/jiangkoumo/pi-pstack/main/package.json) | 優先讀取 writer gate 設計。整包待與指定 Pi 版本及 Herdr 流程核對。 |
| bemoat | 多 harness fork，README 指向 michael-denyer 上游安裝，含子代理、排程模式及轉送 transcript 給設定中的模型等行為。[README](https://raw.githubusercontent.com/bemoat/pstack/main/README.md) | DEFERRED，範圍與現有協作重疊，該 fork 的固定版本、Windows 及執行相依未查證。 |
| 0xrsydn | main manifest 0.16.0，MIT，Node ≥22.19，Pi peer ≥1.1，extension、skills 與各角色模型 fan-out。[manifest](https://raw.githubusercontent.com/0xrsydn/pstack-pi/main/package.json) | DEFERRED，先避免第二套派工與額外模型呼叫。 |
| marcelormendes | main manifest 0.1.0，MIT，Pi peer 無版本下限，開發基準 0.84.4，測試鏈含 Bun／Python，包含代理角色。[manifest](https://raw.githubusercontent.com/marcelormendes/poteto-pi/main/package.json) | DEFERRED，現有 Pi 1.6.0／Windows 相容性需補實測。 |

先以按需載入的 `architect`、`correct` 和 `create-verification-skill` 作為移植候選。前兩者聚焦架構依賴與防重犯，第三個用於產生專案驗證流程。形式驗證先留給有明確 invariant 的專案。tdd 應先與本機既有 TDD Skills 去重，recall／reflect 與 ds-ledger、ds-context-reset 的紀錄及恢復流程部分重疊。unslop 側重文字清理，deterministic 檢查由專案工具負責。poteto-mode 會組合 playbook 及 delegate，整套導入暫緩。表中版本為可追溯快照，移植案發行頻率與 Windows 實測均 NOT TESTED。

## 插件選型與安全評估

下列 pin 僅供比較及鎖定測試樣本。目錄作者欄及授權為發行中繼資料，須以精確發行物的 integrity、內附授權、安裝 scripts、依賴、Pi peer、OS／Node 及執行入口再核對。Pi 文件確認 extension 與 Pi 同程序且擁有程序權限。[Pi Extensions](https://docs.pi.dev/latest/extensions)

| 候選 | 目錄版本／維護者／授權 | 風險、衝突與選型 |
|---|---|---|
| [pi-verify](https://pi.dev/packages/pi-verify) | 0.1.1／conte777／MIT | P0 首測。Profiles 可合併、stage 有 timeout。限制可執行命令及 CWD，測 Windows 子程序取消。與 quality-gates 擇一管理編輯後及完成前的驗證循環。交付以獨立 CLI exit code／CI 為準。 |
| [pi-better-edit](https://pi.dev/packages/pi-better-edit) | 2.21.0／rianico／MIT | P0 第二個單項測試。Hashline 測過期及並行編輯。作者 main 快照是 2.19.2，含 prepare/prepack、WASM 依賴，這些證據不能外推至 2.21.0。先比對既有工具名稱及回呼。[main manifest](https://raw.githubusercontent.com/Rianico/pi-better-edit/main/package.json) |
| [pi-lens](https://pi.dev/packages/pi-lens) | 4.5.2／apmantza／MIT | P0 第三個單項測試。作者文件指出預設可格式化與 autofix，專案設定可覆寫。隔離測試先關閉自動改寫，再核查 LSP/分析器取得方式、語言覆蓋與 better-edit 寫入偵測。[作者來源](https://github.com/apmantza/pi-lens) |
| [@wengine-ai/pi-quality-gates](https://pi.dev/packages/@wengine-ai/pi-quality-gates) | 未從第一手來源核對 | BLOCKED，取得原始碼後確認事件名稱、重試上限、攔截完成語義。 |
| [pi-browser-debug](https://pi.dev/packages/pi-browser-debug) | 2.0.0／nandafirmans／MIT | P0 後段。Playwright Chromium 及 CDP 都需審查。僅測合成 localhost app、專用 profile，查 Console、HTTP failure 與證據儲存。 |
| [protect-context](https://pi.dev/packages/protect-context) | 未核對 | BLOCKED。任務日誌、修改範圍及 compaction 能力待源碼確認，先用既有 ledger 作對照。 |
| [context-mode](https://pi.dev/packages/context-mode) | 2.2.3／mksglu／Elastic-2.0 | BLOCKED。作者標示需 Node ≥24.15.0，本機 24.14.0。預設 npm 安裝及 setup 另有全域與跨 Agent 範圍。 |
| [pi-antiloop](https://pi.dev/packages/pi-antiloop) | 1.10.0／noguerol／MIT | P1。文件列出相似呼叫與結果偵測，預設 abort threshold 範例為 disabled。測三次停止、合理重試誤判、TUI footer 及 Herdr 相容。 |
| [pi-background](https://pi.dev/packages/pi-background) | 未核對 | BLOCKED。待確認 Windows 程序樹、PowerShell、timeout/cancel，再與 CLI runner 比較。 |
| [cc-safety-net](https://pi.dev/packages/cc-safety-net) | 2.8.3／kenryu／MIT | DEFERRED。跨 Agent 安裝入口排除，若有 Pi 專屬配置，再測合成路徑與 Git 命令攔截。權限隔離仍由 OS 控制。 |
| [pi-checkpoints](https://pi.dev/packages/pi-checkpoints) | 未核對 | BLOCKED。任一還原流程需先證明能保留其他 Session 的未提交改動。 |
| [pi-feedback](https://pi.dev/packages/pi-feedback) | 未核對 | BLOCKED。需核查 diff 資料流、發送目的地與本機審查能力。 |
| [@plannotator/pi-extension](https://pi.dev/packages/@plannotator/pi-extension) | 0.29.4／backnotprop／MIT OR Apache-2.0 | DEFERRED。先核查本機 UI、外部分享／Ask AI、工作模式與 activeTools 修改，再與既有 Review 流程比較。 |
| [pi-model-pick](https://pi.dev/packages/pi-model-pick)、[pi-away](https://pi.dev/packages/pi-away)、[pi-heads-up](https://pi.dev/packages/pi-heads-up) | 未核對 | DEFERRED。先對 Pi 1.6.0 原生模型選擇與 scoped models 驗收。 |

## Gate 3 測試設計

保留 Default、Deep Execution、Alt+M 和 DeepSeek Stack。用每個 Session 的模式資料處理隔離，現有共享值只當相容遷移的預設值。Tools、模型、Provider、Thinking 與主題各自獨立。Local 先試最小工具集，Cloud 視需要加入 Runtime Verification，Review 工作區用 OS 唯讀權限。是否新增工作模式等 A/B 結果決定。

從固定 GitHub SHA 建立本任務專屬 worktree 或隔離 clone，並驗證本機既有 checkout 的工作狀態。使用可限制網路與可見目錄的 Windows 測試身分或 VM，不掛載正式 Pi 設定、憑證、正式瀏覽器或公司專案。Pi agent 目錄、家目錄、工作樹、npm cache 與暫存路徑分離。先以無插件、無模型的 deterministic fixture 跑通，再以同一 Pi 版本、同一已確認可用的本地模型、固定初始程式與輸入做配對 A/B。每個模型案例重跑至少三次並保留逐次結果，Cloud 等成本確認後再加入。

| 測試組 | 證據及預期 | 狀態 |
|---|---|---|
| Pi 版本 | 讀本機 package.json，依 verify 的 1.5.x 前綴跑獨立檢查。預期符合 1.5.x，實際 1.6.0，exit 1 | FAIL |
| Git 連線 | `git ls-remote https://github.com/JingFeng-code/AstraGjallarhorn.git`，預期 refs，實際 DNS 失敗，exit 1。GitHub 連線讀取 refs、PR、tree 與指定 blobs 成功 | FAIL（終端傳輸） |
| Hashline、靜態診斷 | 插入一行後送出過期編輯、雙寫同一區域。語法、型別、Lint、架構依賴故障分別注入，修正後重跑 | NOT TESTED |
| 驗證循環 | 合成 .NET、Vue／Nuxt、SQL fixture 分別觸發 build/typecheck/test/schema 失敗。驗證錯誤的完成宣告不能影響 CI，回傳非零，修正後 exit 0 | NOT TESTED |
| 瀏覽器 | loopback fixture 注入 JS error 與 HTTP failure，驗證正常、故障、復原三段及截圖／console 證據 | NOT TESTED |
| Context 與重試 | 大日誌、compaction 恢復、三次重複失敗、逐次有進展的重試。記錄工具次數、任務輸出與交接摘要 | NOT TESTED |
| 長任務 | 合成父子程序驗證 timeout、取消與程序樹清理，保留 PID 與退出狀態 | NOT TESTED |
| 雙 Pi Session | 共用 agent 目錄並行跑 session A/B，單側 Alt+M、reload、重啟及舊狀態遷移。驗證各自模式、技能和 prompt 一致 | NOT TESTED |
| 同步／模型／Herdr | 合成 settings 測 dry run、套用、備份、還原、漂移及中斷。現有本地／雲端模型和 Herdr 另做授權環境回歸 | NOT TESTED |

每次保存命令、預期與實際、exit code、時間、測試版本、去敏證據和還原方法。記錄成功率、驗收率、工具呼叫與無效重試、編輯錯誤、Context、Token、時間、啟動成本及插件造成的錯誤。現在沒有可比較的 A/B 數據，這些量化值皆為 NOT AVAILABLE。

## 修改隔離與下一關

以 `Get-FileHash` 讀取 112 個可讀設定或技能檔案，Codex 1、Claude 2、OpenCode 2、Herdr 6、共用技能 83、Pi 18。在本機唯讀原始碼檢查前後各取一次，`Compare-Object` 無差異。本機快照只含檔案雜湊與範圍資訊。交接文件保留比對結果。涵蓋已定位且選定的路徑，不能延伸到所有外掛檔案或未定位的 checkout。兩個遠端專案均只讀取。工作區保存調查證據與本報告，正式 Pi、Herdr 及其他 Agent 設定無寫入。

首輪盤點當時的下一步是先取得可驗證的 AstraGjallarhorn Git checkout，釐清 1.6.x 支援項目，並針對 P0 首個候選審查固定發行檔與依賴。通過後在隔離環境先跑無插件基線，再逐個擴大。回滾以隔離測試目錄或 VM snapshot 為單位。正式套用前另交付差異、固定版本、備份與還原命令，以及隔離驗收證據供核准。
