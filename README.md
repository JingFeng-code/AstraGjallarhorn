# AstraGjallarhorn

[English](README.en.md) | 繁體中文

Pi Coding Agent 的受控設定同步與工程驗證工具組。v0.3 為開發預覽；本次整合候選已推送供 PR #6 審閱，尚未合併至 main 或正式發布；正式發布版本以 GitHub Releases 為準。

## 功能

- 以白名單同步通用設定，支援 Dry Run、衝突保護、備份與還原。
- Default 與 Deep Execution 模式；模式不會切換模型或 Provider。
- LSP、Diff Review、命令防護、Checkpoint、重試上限、任務恢復與明確授權的交接。
- v0.3 單一 Agent 能依任務按需發現 Architect/Correct Skills；不新增角色、Router 或固定工作流。
- 驗證證據與品質關卡呈現已觀察到的工具結果和受支援專案檢查；不代表所有變更均已驗證。
- 自然語言接續只在候選唯一並確認資料傳遞後讀取中斷紀錄，延續原始需求、歷史工具摘要及結果未知的操作；不自動重跑指令或還原。
- Checkpoint Preview 只預覽；實際還原仍需使用者明確執行既有還原指令。

## 前置條件與開始使用

Windows、Git、PowerShell 7，以及 manifest 固定的 Pi 1.6.1。Node.js 24 用於本機測試；.NET SDK 10.0.401 與 Microsoft Edge 用於相應範例/整合 fixture。專案腳本不會升級 Pi。

在 Repository 根目錄先預覽套用計畫：

    pwsh -NoProfile -File scripts/apply.ps1 -StrictVersion

檢查檔案清單、版本、備份及衝突後，才自行加上 -Apply 寫入。完整操作方式見[操作指南](docs/operations-manual.md)。

## 公開與私人資料邊界

匯出預設為 Dry Run；寫入必須使用 -Apply 並明確指定 -RepoPath，且由已認證的 GitHub CLI（gh）確認私人 GitHub repository。公開、internal、未知或不支援的目的地一律拒絕。預覽私人設定時請使用 -NoDiff 避免差異出現在日誌。

公開 Repository 僅供通用程式碼、測試與文件使用。個人 Pi 設定、Provider 憑證、Session、備份、原始驗收輸出、公司資料及私人工作紀錄應留在本機或獨立私人 Repository。不要 mirror push 私人 refs。

測試 fixture 使用合成資料。腳本與第三方套件以使用者權限執行，並非 OS sandbox；Provider 與模型服務可能產生費用，使用者需自行確認。

[安全政策](SECURITY.md) · [MIT 授權](LICENSE) · [第三方授權](THIRD_PARTY_NOTICES.md)
