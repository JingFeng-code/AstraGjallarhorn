# AstraGjallarhorn 跨電腦交接

開發分支為 `feat/gate-recovery-foundation`，基礎修正 commit 為 `8565ad189e601d77fdd4c01d1ebde4927f3a7ddc`。以本分支最新 commit 取得交接文件。起始 `main` 為 `cf0f5248562ca3d061229ec0aa8d2f9b658227e4`。

2026-11-25 在第二台 Windows 電腦以 Pi 1.6.0、Node 24.18.0、PowerShell 7.6.9 重跑 RPC 及同步回歸，兩者皆通過。隔離 Windows TTY 驗證 Alt+M 雙向切換、手動 /reload 保留模式及 /tree 開啟空 Session 的樹狀檢視。正式 Pi 已套用 Session 隔離修正及兩個既有套件的固定來源，`scripts/verify.ps1` 回傳 0（15 PASS、0 FAIL、1 MANUAL）。正式 TTY 補測 Alt+M 雙向切換，Herdr 隔離工作終端觀察到 Pi 的 idle、Provider、模型標籤及 Alt+M 切換。新增 [SQLite 驗證範例](examples/sql/README.md) 及 Windows CI，四項故障注入在本機、分支 CI 及 Draft PR CI 皆通過正常／失敗／修復序列。下方續接項目中，有訊息的 Tree 分支、Herdr 工作中及完成狀態、模型比較、pstack 完整工程實測及第三方候選仍待驗收。

本機 SHA-256 基準比對涵蓋 340 個檔案。339 個一致，唯一差異是 Codex 的模型快取；未對該檔執行寫入。Pi 的認證、模型設定、舊模式預設及 `astra-herdr.js` 雜湊一致。正式備份由 apply 輸出其本機路徑，還原使用 `scripts/apply.ps1 -Restore -RestoreFrom <備份路徑>` 預覽，再視需要加上 `-Apply`。

新增 [C#](examples/dotnet/README.md) 與 [Vue／TypeScript](examples/vue/README.md) 工程驗證。Windows 本機驗證 C# 的編譯型別、Roslyn 分析、ArchUnitNET 邊界及 xUnit 整合測試故障。Vue 驗證 lint、vue-tsc、Vitest 和瀏覽器 runtime 故障。各項均跑過正常、故障、還原。Vue 的型別錯誤退出碼為 2，其餘上述注入為 1。Playwright 的首次故障注入暴露原測試只抓 pageerror。加入 console error 檢查後，Vue 記錄的例外會使 E2E 失敗。

pstack `architect` 已同步至正式 Pi 的 `agent/skills/architect`。隔離 Pi 使用本機 Ollama 的 `mimo-v2.6-agent32k:latest` 完成 SQLite 模組邊界與相依方向比較，指定的驗證命令已獨立執行並回傳 0。三次工具讀取中兩次成功，一次將目錄當作檔案讀取而失敗。正式 Pi 透過 RPC 查得 `skill:architect`，其 frontmatter 設定由使用者明確呼叫才載入。正式套用只有新增技能與隨附 MIT 授權兩個檔案。隔離測試可探索三個 pstack 指令，`correct` 的兩次實測分別因執行時間與重複呼叫不可用工具而停止。

- [Gate 0–2 首輪盤點](docs/verification/gate-0-2.md)
- [Gate Recovery 修正與驗證證據](docs/verification/gate-recovery.md)

## 已完成

- 工作模式儲存於 Pi Session。共用的舊 `mode-state.json` 保留為唯讀預設，缺少或無效時使用 Default。指定獨立 agent 目錄時，模式資源由相鄰的 `modes` 載入。
- 套件同步固定 `pi-agnes-tools@0.3.7` 與 `pi-ollama-cloud@0.13.1` 的來源，保留設定中的資源篩選及未知欄位。驗證區分來源、manifest、安裝版本及重複宣告。匯出和套用保護有衝突的本機修改。
- 原機重新比對選定的 112 個保護檔案，差異為零。驗證報告保留比對結論。

## 重跑已通過的驗證

在可寫的專用開發目錄 clone，或在乾淨的既有 checkout 切至交接分支。先確認本機 Pi 版本。下列 RPC 測試直接執行已安裝的 Pi Node CLI，請在目前 PowerShell 將 `$PiCli` 設為該入口。使用 Pi launcher 指向的實際入口，Windows npm 安裝可檢查 `pi.cmd`。同步測試從 PATH 呼叫 Pi。

```powershell
git clone --branch feat/gate-recovery-foundation https://github.com/JingFeng-code/AstraGjallarhorn.git
Set-Location AstraGjallarhorn
git status --short --branch
git merge-base --is-ancestor 8565ad189e601d77fdd4c01d1ebde4927f3a7ddc HEAD
pi --version
node tests/mode-rpc.mjs $PiCli
pwsh -NoProfile -File tests/sync.ps1
```

上次在 Windows、Pi **1.6.0**、Node **24.14.0** 執行，兩個測試入口均回傳 **0**。RPC 使用同一隔離 agent 目錄的兩個真實 Pi 程序，覆蓋 Default／Deep Execution 的 0／7 個 DeepSeek Skills、切換與 reload、新 Session、Resume、Fork 和舊狀態檔容錯。同步使用合成設定，覆蓋 dry-run、pin 合併及驗證、備份還原與工作樹保護。測試內部確認未固定來源及重複項回傳 **1**，apply／export 衝突回傳 **3**。其他 Pi 版本及實際 Provider 請求未驗證。

## 尚未完成與接續順序

1. **Gate 0-R2** 在隔離 Windows 互動終端補測 Alt+M、手動 `/reload`、Tree、Herdr 狀態回報及含模型回合的提示一致性。原測試終端在進入 TUI 前回報 `setRawMode EPERM`。Tree 設計為維持 Session 模式。Pi 在第一個對話訊息之前尚無可持久化的 Session 檔，這段期間的模式可在同程序 reload 後保留。還原前先預覽，確認備份後新增的設定編輯可保留。
2. **Gate 1-R** 已確認 `architect`、`correct`、`create-verification-skill` 的明確呼叫探索。補測架構邊界、根因與防重犯、可重現的驗證命令。先將生成路徑改為 Pi 專屬位置，並審查必要的參考檔。上游固定 commit 與驗證證據見 Gate Recovery 報告。
3. **Gate 2-R** 完成下表三個指定發行物的來源比對、遞迴相依、執行外連與 Windows 相容性審查。三份 npm tarball 均已核對 SHA-512 與內附 MIT 授權，未執行套件。
4. **Gate 3-A/B/C** 在基礎與個別安全 Gate 通過後，依序實測驗證命令的 pass/fail/timeout、Hashline 的過期編輯防護、C#／TypeScript 診斷。各自通過後再測組合。目前沒有插件執行或 A/B 數據。

| 固定候選 | 待確認重點 |
|---|---|
| `pi-verify@0.1.1` | 發行物的上游來源、專案命令信任界線、Windows timeout 和程序清理。 |
| `pi-better-edit@2.21.0` | Bundle 對照、`read`／`edit` 覆寫、並行編輯和診斷相容性。 |
| `pi-lens@4.5.2` | Native 依賴、grammar／LSP 下載、網路權限與自動格式化行為。 |
| `context-mode@2.2.3` | DEFERRED。Node 最低要求 24.15.0，原機為 24.14.0。 |

保持測試目錄與正式 Pi、公司資料、共用 Skills、其他 Agent 和 Herdr 設定分離。第三方執行測試需具備實際的 OS 與網路限制。正式 Pi 套用、全域工具升級或額外費用須依原任務授權處理。
