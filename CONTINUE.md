# AstraGjallarhorn 跨電腦交接

開發分支為 `feat/gate-recovery-foundation`，基礎修正 commit 為 `8565ad189e601d77fdd4c01d1ebde4927f3a7ddc`。以本分支最新 commit 取得交接文件。起始 `main` 為 `cf0f5248562ca3d061229ec0aa8d2f9b658227e4`。

2026-11-25 在第二台 Windows 電腦以 Pi 1.6.0、Node 24.18.0、PowerShell 7.6.9 重跑 RPC 及同步回歸，兩者皆通過。隔離 Windows TTY 驗證 Alt+M 雙向切換、手動 /reload 保留模式及 /tree 開啟空 Session 的樹狀檢視。正式 Pi 已套用 Session 隔離修正及兩個既有套件的固定來源，`scripts/verify.ps1` 回傳 0（15 PASS、0 FAIL、1 MANUAL）。正式 TTY 補測 Alt+M 雙向切換，Herdr 隔離工作終端觀察到 Pi 的 idle、Provider、模型標籤及 Alt+M 切換。新增 [SQLite 驗證範例](examples/sql/README.md) 及 Windows CI，四項故障注入在本機、分支 CI 及 Draft PR CI 皆通過正常／失敗／修復序列。後續 Tree 分支及 Herdr 狀態見能力驗收紀錄。

本機 SHA-256 基準比對涵蓋 340 個檔案。339 個一致，唯一差異是 Codex 的模型快取；未對該檔執行寫入。Pi 的認證、模型設定、舊模式預設及 `astra-herdr.js` 雜湊一致。正式備份由 apply 輸出其本機路徑，還原使用 `scripts/apply.ps1 -Restore -RestoreFrom <備份路徑>` 預覽，再視需要加上 `-Apply`。

新增 [C#](examples/dotnet/README.md) 與 [Vue／TypeScript](examples/vue/README.md) 工程驗證。Windows 本機驗證 C# 的編譯型別、Roslyn 分析、ArchUnitNET 邊界及 xUnit 整合測試故障。Vue 驗證 lint、vue-tsc、Vitest 和瀏覽器 runtime 故障。各項均跑過正常、故障、還原。Vue 的型別錯誤退出碼為 2，其餘上述注入為 1。Playwright 的首次故障注入暴露原測試只抓 pageerror。加入 console error 檢查後，Vue 記錄的例外會使 E2E 失敗。

pstack `architect` 已同步至正式 Pi 的 `agent/skills/architect`。隔離 Pi 使用本機 Ollama 的 `mimo-v2.6-agent32k:latest` 完成 SQLite 模組邊界與相依方向比較，指定的驗證命令已獨立執行並回傳 0。三次工具讀取中兩次成功，一次將目錄當作檔案讀取而失敗。正式 Pi 透過 RPC 查得 `skill:architect`，其 frontmatter 設定由使用者明確呼叫才載入。正式套用只有新增技能與隨附 MIT 授權兩個檔案。隔離測試可探索三個 pstack 指令，`correct` 的兩次實測分別因執行時間與重複呼叫不可用工具而停止。

`create-verification-skill` 的隔離模型輸出使用範例 CLI 未提供的參數，未放行。還原增加套用後原始位元組 SHA-256 比對。同步回歸確認擴充功能或 settings.json 有後續修改時，還原回傳 3，保留全部檔案。第二台電腦前兩次正式備份為這項修正前的格式，仍可預覽。正式復原舊備份前，先手動核對列出的衝突。

- [Gate 0–2 首輪盤點](docs/verification/gate-0-2.md)
- [Gate Recovery 修正與驗證證據](docs/verification/gate-recovery.md)
- [Pi 能力驗收與共用 CI 入口](docs/verification/capability-completion.md)

後續新增兩個 Pi 專屬擴充。正式 Pi 1.6.0 RPC 已驗證 `/hashline`、`/hashreplace` 的同文精準定位、CRLF 保留及過期拒寫。正式 RPC 亦驗證 `/tool-profile review|cloud|local|restore`，模型與 Thinking Level 一致。各自套用前 dry-run 只新增一個檔案。兩個擴充由 Pi Config Manifest 同步，沒有 npm 套件新增。Hashline 的整檔快照檢查不涵蓋外部程序恰在最終比對與重新命名之間寫入的競爭。LSP、剩餘 pstack 技能與模型 A/B 仍待驗收。

2026-11-26 已在實際 Windows Sandbox 測試兩個候選。Better Edit 行錨替換與 stale refusal 通過。Lens 的 TypeScript 型別錯誤、定義和引用通過；乾淨 LSP 回報 inconclusive，編譯器確認修正。正式插件放行與未完成項目見上述能力驗收文件。

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

早期基準在 Windows、Pi **1.6.0**、Node **24.14.0** 執行，兩個測試入口均回傳 **0**。RPC 使用同一隔離 agent 目錄的兩個真實 Pi 程序，覆蓋 Default／Deep Execution 的 0／7 個 DeepSeek Skills、切換與 reload、新 Session、Resume、Fork 和舊狀態檔容錯。同步使用合成設定，覆蓋 dry-run、pin 合併及驗證、備份還原與工作樹保護。測試內部確認未固定來源及重複項回傳 **1**，apply／export 衝突回傳 **3**。其他 Pi 版本及實際 Provider 請求未驗證。

## 目前驗收狀態

- 正式 Pi 1.6.0 已安裝第一方 Hashline、工具設定及重試上限。重試上限預設關閉，`/retry-limit on` 啟用。隔離與正式安裝檔副本的真實 Pi RPC 都在第 3 次相同工具失敗後停止，測試提供者未收到第 4 次請求。
- Better Edit 2.21.0 在離線 Windows Sandbox 經由 Pi 正常工具調度完成讀取、過期拒寫、重讀、精準編輯。模型回應由本機測試提供者依序回傳，真實 Ollama 模型與全量正式擴充組合仍待驗收。正式保留既有 Hashline。
- Lens 4.5.2 的 TypeScript 錯誤、定義與引用已有 Sandbox 證據。乾淨檔案 LSP 回報 inconclusive，獨立編譯器確認修正。C# LSP、下載控制與真實模型工具整合未放行。
- pstack 的 architect 已正式驗收。correct、create-verification-skill 與真實模型 A/B 仍待驗收。
- Node 24.18.0 已符合 context-mode 2.2.3 的 Node 最低版本。Runtime 行為尚未放行。pi-verify 的上游比對仍待確認，現有工程驗證使用 Pi RPC 與 CI 共用腳本。
- Sandbox 已通過離線 Windows 執行驗收，僅用於開發測試。跨機正式流程維持先 dry-run，確認範圍後 Apply，再執行 Verify。

早期 Gate 歷史和已完成的測試保存在上方連結，不需要重新驗證 Sandbox 啟用或重做已通過的候選測試。

本輪正式更新 Retry Limit。設定隨 Session 保留，新增明確選用的 strict 與手動 handoff。正式安裝檔副本透過 Pi RPC 通過 reload、三個不同 shell 非零退出碼、沒有第 4 次請求、摘要讀取及新 Session 預設關閉。SQL CI 加入固定 Pi 1.6.0 的模式、Retry Limit RPC 與同步回歸。Context Mode 2.2.3 已在離線 Sandbox 經正常 Pi 調度完成合成內容索引與搜尋。正式環境的攔截政策、Compaction、恢復與真實模型效益仍待確認。
