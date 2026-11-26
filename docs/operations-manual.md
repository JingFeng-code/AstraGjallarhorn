# 操作指南 / Operations

適用於目前 main 的初始同步版本；進階 v0.2/v0.3 功能尚未合併。

## 安裝與還原

- Windows + PowerShell 7 + Git；Pi 版本以 [manifest](../manifests/packages.json) 為準。
- 先執行 `pwsh -NoProfile -File scripts/apply.ps1 -StrictVersion`（Dry Run）。
- 確認計畫後才加 `-Apply`；衝突預設停止。套件安裝需要另行確認；不自動升級 Pi。
- `pwsh -NoProfile -File scripts/verify.ps1`：退出碼 0 可包含 WARN/MANUAL，不代表所有互動測試通過。
- `pwsh -NoProfile -File scripts/apply.ps1 -Restore -RestoreLatest` 預覽還原，檢查範圍後才加 `-Apply`。指定備份用 `-RestoreFrom`。不要直接覆寫使用者的新修改。

## 私人同步

僅在獨立私人 repository 中操作：`pwsh -NoProfile -File scripts/export.ps1 -DryRun` 預覽，確認路徑、遠端與內容後再匯出。匯出程式不負責提交或 Push。逐檔審查，不要自動 git add -A 或 mirror push。Provider 名稱清單不是認證；憑證只能留在本機。不要把真實設備狀態、公司資料或私人工作日誌推送到公開上游。

## 限制

模式只影響 Skills 與系統提示，不切換模型或 Provider。Alt+M 需要人工 TTY 驗證。安全掃描不保證識別所有機密；腳本與第三方套件以使用者權限執行。測試請使用合成資料與隔離工作區。進階測試指令待相應 PR 合併時更新。
