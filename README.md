# AstraGjallarhorn

[English](README.en.md) | 繁體中文

Pi Coding Agent 的受控設定同步與工程驗證工具組，名稱源於北歐神話中海姆達爾的號角 Gjallarhorn。

## 開發狀態

目前 main 是初始設定同步版本，支援 Windows 上的 Default / Deep Execution 模式、白名單匯出、Dry Run、備份、衝突保護與還原。進階工程能力正在 [v0.2](https://github.com/JingFeng-code/AstraGjallarhorn/pull/3) 與 [v0.3](https://github.com/JingFeng-code/AstraGjallarhorn/pull/4) 開發分支驗證，尚未合併或正式發布。請勿將開發分支的功能或驗收結果視為 main 的功能或正式產品認證。

## 開始使用

目前 main 的 Pi 相容版本以 [套件清單](manifests/packages.json) 為準（1.5.x）。使用 Windows、Git 與 PowerShell 7，先檢查來源與相依套件，再預覽：

```powershell
pwsh -NoProfile -File scripts/apply.ps1 -StrictVersion
```

預設不寫入。確認備份、衝突與套件計畫後才自行決定是否加入 `-Apply`。本工具不升級 Pi；不符合版本請停止。詳見[操作指南](docs/operations-manual.md)。

## 公開上游與個人同步

公開 repository 用於通用程式碼與文件，不是個人 Pi 設定的同步目的地。使用獨立 Private repository 保存經審查的個人設定。不要將真實 Provider 設定、憑證、Session、備份、公司資料或原始日誌推送至此，亦不要 mirror push。

工具層防護不是 OS sandbox；請先在隔離環境使用合成資料測試。Provider 與第三方服務費用須獨立確認。

[安全政策](SECURITY.md) · [MIT 授權](LICENSE) · [第三方授權](THIRD_PARTY_NOTICES.md)
