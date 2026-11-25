# AstraGjallarhorn 基礎修正與驗證紀錄

2026-11-25（Asia/Taipei）

## 交付狀態

| Gate | 結果 | 證據 |
|---|---|---|
| 0-R1 | PASS（checkout） | 正式網路核准後 `git ls-remote` 回傳 0，遠端 main 為 `cf0f5248562ca3d061229ec0aa8d2f9b658227e4`。沙箱預設網路的同一命令回傳 128 並報 DNS 解析失敗。已建立任務專用 clone。 |
| 0-R2 | 部分 PASS，整體 BLOCKED | Pi 1.6.0 雙程序 RPC 與同步測試均為 0。互動終端以 `setRawMode EPERM` 回傳 1，Alt+M、Tree、Herdr 相容性及含模型回合的 prompt 驗收仍未測。 |
| 1-R | 部分 PASS | 指定三個 Skills 在 Pi 1.6.0 隔離 agent 目錄可發現，保持明確呼叫屬性。工程任務效果 NOT TESTED。 |
| 2-R | BLOCKED | 三個鎖版發行物均通過 SHA-512 及 MIT 授權檔檢查。上游一致性、遞迴相依和 Windows 執行審查仍有缺口。 |
| 3-A/B/C | NOT TESTED | 依 Gate 前置條件，沒有安裝、載入或執行三個 npm 插件。無 A/B、成本或效能實測數據。 |

本機開發分支 `feat/gate-recovery-foundation`，commit `8565ad189e601d77fdd4c01d1ebde4927f3a7ddc`，工作樹乾淨。未推送、未建立 Draft PR。未修改 main。起始及最終重新比對上一輪 112 個檔案的 SHA-256，差異 0。沒有修改正式 Pi、Herdr、AstraAegis、其他 Agent 或共用 Skills，也未升級全域工具或使用付費模型。

## 基礎修正及重現

- 模式改寫入 Pi Session 的自訂紀錄。讀取最新有效紀錄，舊 `mode-state.json` 提供沒有紀錄時的唯讀預設。缺少或損壞時回退 Default。Fork 讀取複製到新 Session 的紀錄，Tree 設計為維持 Session 模式。Pi 在第一個對話訊息前不建立 Session 檔，這段期間的切換可在程序內 reload 保留。自訂 agent 目錄使用同層的 `modes`，fixture 同時隔離家目錄、工作目錄、設定及 Session，避免讀取正式 Pi 的 Skills 與 Modes。
- 針對 `pi-agnes-tools@0.3.7` 與 `pi-ollama-cloud@0.13.1`，apply 固定受管來源，保留物件來源的資源篩選及未知欄位。verify 分別檢查來源、清單版本、安裝版本和重複項。export 遇到無法取得版本、來源漂移或重複項時中止，避免建立無效 pin。實際匯出前按目標檢查 Git 工作樹。Pi 基線只列已測的 1.6.0。
- 備份以唯一目錄保存。合成設定還原通過，設定檔位元組 SHA-256 恢復原值，套用才建立的模式檔亦已移除。Restore 仍可能覆蓋備份之後的合法設定編輯，使用時需審查 dry run。實際安裝既有套件的流程及中途失敗恢復未驗證。

在開發分支目錄執行。先在目前 PowerShell 將 `$PiCli` 設為已安裝 Pi 1.6.0 的 Node CLI 入口。第一條命令的第三個參數可選，傳入三份已查驗 pstack Skills 的父目錄，即會加跑明確技能探索測試。

```powershell
node tests/mode-rpc.mjs $PiCli
pwsh -NoProfile -File tests/sync.ps1
git diff 8565ad1^ 8565ad1 --check
```

| 驗證 | 實際結果 |
|---|---|
| Pi 1.6.0 RPC | Exit 0。兩個同時運行的 Pi 程序共用 agent 目錄，初始均 0 個 ds-*。B 切到 Deep Execution 後為 7，A 保持 0。A 切為 7、B 回到 0 亦通過。真實 `/mode` 指令、由指令觸發的 reload、extension 及 skill discovery、新建、Resume、Fork、舊檔缺少／損壞皆通過。比較切換前後 RPC model 欄位及 Thinking Level。未呼叫模型。 |
| 同步 | Exit 0。fixture 內部確認 fixed pin verify 0、floating source verify 1、重複項 apply 1、apply 檔案衝突與 export 未提交檔案保護均為 3。apply／export／restore dry-run、套用、備份與還原通過。套件安裝版本使用合成 package.json。 |
| 互動驗證 | 隔離 Windows PTY 到達信任畫面，主畫面前出現 `setRawMode EPERM`，exit 1。Alt+M、手動 `/reload`、Tree UI、實際 Herdr 狀態回報、實際模型 prompt 及既有套件功能仍為 NOT TESTED。 |

## pstack 最小驗證

三份文件及 MIT 授權取自上游固定 commit `41e400932eca14f289e7db717a70455256b6d388`。只複製 SKILL.md 到臨時 Pi agent 目錄，RPC 查得三個 `skill:` 指令，原始文件均設 `disable-model-invocation: true`。未修改共用技能，未新增 Subagent 框架。

| Skill | 內容與限制 |
|---|---|
| architect | 檢查現有依賴邊界並尋找能由規則執行的約束。建立真實架構邊界的成果仍未驗證。 |
| correct | 優先把錯誤轉換成架構、型別、Lint 或回歸測試。根因分析與防重犯成果仍未驗證。 |
| create-verification-skill | 原文指定 `.cursor/skills` 並引用 feature map 範例。未執行該指令。移植時需改用 Pi 專屬專案路徑並帶入必要參考檔，再以故障和修正前後的 exit code 驗證產出。 |

[固定上游來源](https://github.com/cursor/plugins/tree/41e400932eca14f289e7db717a70455256b6d388/pstack)

## 指定發行物審查

`npm pack --ignore-scripts` 只將指定版本下載至暫存工作區。以 PowerShell 計算 tarball SHA-512，三個皆吻合獨立取得的 `dist.integrity`。內附 LICENSE 均為 MIT。沒有執行 npm lifecycle 或載入 extension。Windows 實際可用性、執行時對外請求及完整遞迴相依仍待審查。

| 發行物 | 從發行檔查證 | 執行前仍需確認 |
|---|---|---|
| [pi-verify@0.1.1](https://www.npmjs.com/package/pi-verify/v/0.1.1) | 無 engines 與直接 runtime 依賴，Pi peers 為 `*`。有 `prepack`，無 install lifecycle。註冊 `verify_code`，依專案配置執行 `pi.exec` 命令，提供 timeout 及 exit code。 | Registry 無 repo 或 gitHead，來源對應未證實。須驗證專案命令信任邊界、Windows 程序清理、失敗的交付判定、憑證隔離及無模型循環。 |
| [pi-better-edit@2.21.0](https://www.npmjs.com/package/pi-better-edit/v/2.21.0) | Node ≥24，Pi peer ≥0.75。發行 manifest 未見安裝 lifecycle。含 diff、file-type、unbash、xxhash-wasm。發行入口註冊原生名稱 `read`、`edit`，也有 `tool_call` hook。 | 上游標籤 commit `b89f5cf2f057c6ede61e6b51015d57add5d393d5` 的主要 manifest 欄位對得上，bundled code 尚未重建比對。需檢查 hook、子程序及與 lens 編輯後診斷的交互作用。 |
| [pi-lens@4.5.2](https://www.npmjs.com/package/pi-lens/v/4.5.2) | Node ≥22.19，Pi peer `*`。Registry gitHead `dfdd854ed3ae3797b96d960e274e46f0ad439ccb` 的主要 manifest 欄位對得上。含 ast-grep CLI／NAPI、js-yaml、minimatch、pidusage、vscode-jsonrpc。manifest 的 `prepare` 下載 grammar；發行入口也有 runtime 下載路徑。 | 尚需核查 native binary、grammar 與 LSP 下載檢查、C#／TS、程序環境變數／憑證來源、格式化或 autofix 與 better-edit 的並行衝突。Git source 安裝與 npm 發行檔行為需分別審查。 |

三個候選均未完成實際 Pi API 相容性、安全和零額外費用驗收。靜態審查見到可執行命令與下載路徑，因此需要隔離執行身分和網路限制。context-mode 繼續 DEFERRED，未擴大插件範圍。
