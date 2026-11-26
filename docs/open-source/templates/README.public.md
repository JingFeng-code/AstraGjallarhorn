# AstraGjallarhorn

[English](README.en.md) | 繁體中文

Pi Coding Agent 的驗證優先工程工具組。使用自然語言交付任務，讓 Agent 以實際證據重現問題、修復、驗證與審查，而非要求使用者管理角色選單。

**v0.3 開發預覽**：尚未正式發布。原私人開發版已完成四個限定契約的本機模型修復案例（Node.js、SQLite、C#、Vue），跨層 Vue／ASP.NET Core／SQLite fixture 曾通過 CI；本乾淨快照仍須重新驗證，不能把歷史結果視為此版本的認證。EF Core、正式資料庫與任意專案／模型尚未驗證。

## 功能

- 設定匯出、Dry Run、衝突保護、備份與還原。
- 指令防護、Git Checkpoint、任務恢復、Retry Limit、唯讀 Diff Review。
- TypeScript／C# LSP；不自動下載伺服器。
- Default／Deep Execution 模式及按需使用 Skills。
- 明確授權的實驗性 Quality Gate（預設關閉）。
- 可選 Herdr 交接（預設關閉）；不自行切換模型或供應商。

## 開始使用

Windows、PowerShell 7、Git、Node 24 與 [manifest](manifests/packages.json) 釘選的 Pi 版本。先檢查可信任的 checkout，再執行：

```powershell
pwsh -NoProfile -File scripts/apply.ps1 -StrictVersion
```

這是 Dry Run。確認修改範圍、備份、版本與第三方套件後，才由使用者決定是否加入 `-Apply`。詳見[操作與驗證指南](docs/operations-manual.md)。

**公開上游不是個人同步儲存庫。** 需要同步私人設定時，請使用獨立 Private repository；不要把 export 結果、Session、Checkpoint 或原始日誌推送到公開上游。不要使用 mirror push。

## 安全及授權

工具層限制不是 OS Sandbox，不保證所有機密都被遮罩或程式正確。請在隔離測試工作區使用合成資料。不要因為本工具而啟用額外付費服務。Provider 使用費、第三方資源及 CI 超額費仍由各服務規則決定。

[安全政策](SECURITY.md) · [MIT](LICENSE) · [第三方授權](THIRD_PARTY_NOTICES.md)

名稱源於北歐神話中海姆達爾的號角 Gjallarhorn，以可信訊號與設定傳遞為品牌比喻。
