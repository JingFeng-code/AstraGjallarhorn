# 操作指南 / Operations Manual

本手冊適用於 v0.3 開發預覽；正式發布版本以 GitHub Releases 為準。指令均從 Repository 根目錄執行。

## 版本與需求

- Windows、Git、PowerShell 7。
- Pi 固定為 manifests/packages.json 中的 1.6.1。同步腳本不會安裝或升級 Pi。
- Node.js 24 用於測試與驗證腳本；.NET SDK 10.0.401 用於 .NET 範例；Microsoft Edge 用於瀏覽器 fixture。
- 只在隔離工作區使用合成資料。不要以真實帳戶、公司資料或正式資料庫執行範例。

## 安裝、套用與還原

先預覽：

    pwsh -NoProfile -File scripts/apply.ps1 -StrictVersion

確認套用範圍、來源版本、備份位置與衝突策略後，才加上 -Apply。腳本不升級 Pi；版本不符時應停止並依 manifest 安裝正確版本。

預覽最近一次備份的還原計畫：

    pwsh -NoProfile -File scripts/apply.ps1 -Restore -RestoreLatest

指定備份時使用 -RestoreFrom。檢查計畫及檔案狀態後才加 -Apply。還原前會保護目前修改；不要直接覆寫尚未備份的新內容。

檢查目前設定：

    pwsh -NoProfile -File scripts/verify.ps1

退出碼 0 仍可能包含 WARN 或 MANUAL；它不等同所有互動、模型或技術棧驗收都通過。

## 私人設定同步

個人匯出只應寫到你控制的私人 Repository。先準備包含相容 manifest 的獨立私人 GitHub 工作樹。預設為預覽，不寫入目標工作樹、不查詢 GitHub；加 -NoDiff 避免私人差異出現在日誌。暫存 manifest 會於結束時清除。

    pwsh -NoProfile -File scripts/export.ps1 -RepoPath <private-repo> -NoDiff
    pwsh -NoProfile -File scripts/export.ps1 -RepoPath <private-repo> -Apply -NoDiff

實際寫入需 git、已認證 gh、明確 -Apply 與工作樹根目錄 -RepoPath。唯一 origin 的有效 fetch/push URL 必須同指向 GitHub.com 的同一私人 repository，API 必須確認 private、visibility 與名稱一致；寫入前再次查核。公開上游、public/internal、無 remote、多 remote、不同 push URL、非 GitHub.com、無法認證或查詢失敗均拒絕；無離線覆寫選項。支援 HTTPS（不含憑證）與常見 GitHub SSH 格式。提交前仍須審查檔案及遠端，私人狀態可能日後變更。匯出腳本不會替你提交或推送。不要使用 git add -A、mirror push，或把憑證、Session、備份、公司資料及私人日誌送到公開上游。

Provider 名稱清單不含認證資料。憑證與個人設定留在本機；若需指定私人位置，使用你自己的環境變數或相對路徑，不要把個人路徑寫入公開文件或版本控制。

## 工作模式與 v0.3 行為

Default 與 Deep Execution 模式調整 Skills 和系統提示；它們不切換模型或 Provider。Alt+M 需互動式 TTY。

Architect 與 Correct 可由模型依任務按需發現，模型不保證每次都選用；create-verification-skill 保留明確觸發，避免意外建立設定。Retry Limit 對同一工具及相同參數的連續失敗設上限；不同參數的正常除錯不會被當成同一失敗。自動交接預設關閉，需明確授權。

resume_interrupted_task 只在當前工作目錄尋找中斷任務。候選必須唯一；接續前會要求確認是否將原始需求與工具摘要傳給目前模型。它會重讀紀錄並核對狀態，不會自動重跑指令、啟動程序或還原檔案。

verification_status 顯示本回合已觀察到的檢查結果；證據只保留必要的工具結果與有限 Git 指紋，不代表非 Git 狀態或所有外部變更均已覆蓋。品質關卡只報告實際可觀察的受支援檢查；缺少或未知的證據應視為未驗證。

checkpoint_preview 只預覽具有可核對來源的 Checkpoint 與預計還原範圍，不會改寫工作檔或正式 index。實際還原仍使用明確授權的既有指令。還原會核對來源、路徑及目前檔案狀態；它不是多檔交易，也不是 OS 隔離機制。

LSP、Diff Review、命令防護與 Checkpoint 提供輔助資訊和操作防護，不會自動擴大權限。Diff Review 對輸出設有上限，截斷時應縮小檢視範圍。

## 本機驗證

不呼叫模型的核心驗證入口：

    pwsh -NoProfile -File scripts/accept-v03.ps1 -SkipModel

其他既有檢查：

    node --test tests/*.test.mjs
    pwsh -NoProfile -File scripts/verify-project.ps1 -Suite sql
    pwsh -NoProfile -File scripts/verify-project.ps1 -Suite dotnet
    pwsh -NoProfile -File scripts/verify-project.ps1 -Suite vue
    node tests/fullstack-fixture.mjs

Full-stack fixture 使用暫存 Vue、ASP.NET Core API 與 SQLite 合成資料，從瀏覽器操作至 UI 顯示並獨立核對資料庫。它不連線正式資料庫、不代表所有部署環境通過，也不是 OS sandbox。若缺少 SDK、測試依賴或瀏覽器，應標記該項未驗證，不要改測試期待值。

## 安全與操作限制

本專案不是 OS sandbox。腳本與第三方套件繼承目前使用者權限；測試只用合成資料。不要將 API keys、tokens、私人 Session、公司資料或原始私人驗收輸出放入公開 Repository。Actions 維持停用；本機驗證不需要雲端 CI。工具本身不保證零費用，執行任何 Provider 或模型前須另行確認其收費政策。

---

## English

This manual applies to the v0.3 development preview; see GitHub Releases for published versions. Run commands from the repository root.

### Version and prerequisites

- Windows, Git, and PowerShell 7.
- Pi is pinned to 1.6.1 in manifests/packages.json. Sync scripts do not install or upgrade Pi.
- Node.js 24 is used for tests and verification scripts; .NET SDK 10.0.401 is used for the .NET example; Microsoft Edge is used by the browser fixture.
- Use synthetic data in an isolated workspace. Do not run examples against real accounts, company data, or production databases.

### Apply and restore

Preview first:

    pwsh -NoProfile -File scripts/apply.ps1 -StrictVersion

Review the scope, source version, backup plan, and conflict policy before adding -Apply. The script does not upgrade Pi. Stop if the installed version does not match the manifest.

Preview the latest backup restore:

    pwsh -NoProfile -File scripts/apply.ps1 -Restore -RestoreLatest

Use -RestoreFrom to select a backup. Review the plan and current file state before adding -Apply. Restore protects current changes; do not overwrite new work that has not been backed up.

Verify the current setup:

    pwsh -NoProfile -File scripts/verify.ps1

Exit code 0 may still include WARN or MANUAL items. It does not mean all interactive, model, or stack-specific acceptance has passed.

### Private configuration sync

Export personal configuration only to a separate private GitHub working tree you control, with compatible manifests. A dry run is the default: it does not change the destination working tree or query GitHub. Use -NoDiff to avoid private diffs in logs; temporary manifests are cleaned up on exit.

    pwsh -NoProfile -File scripts/export.ps1 -RepoPath <private-repo> -NoDiff
    pwsh -NoProfile -File scripts/export.ps1 -RepoPath <private-repo> -Apply -NoDiff

Writing requires git, authenticated gh, explicit -Apply and the working tree root as -RepoPath. The sole origin must have one effective fetch and push URL for the same GitHub.com repository. The API must confirm private, visibility and matching full name; this is checked again before writing. Public upstream, public/internal, absent or multiple remotes, differing push destinations, non-GitHub.com URLs, authentication and lookup failures are refused; no offline override. Common HTTPS (no embedded credentials) and GitHub SSH forms are supported. Review files and destination again before committing: visibility can change later. The export script does not commit or push for you. Do not use git add -A or mirror-push, and never send credentials, sessions, backups, company data, or private logs to the public upstream.

Provider names do not include authentication. Keep credentials and personal settings local. If a private location is needed, use your own environment variables or relative paths; do not place personal paths in public documentation or version control.

### Modes and v0.3 behavior

Default and Deep Execution modes change Skills and system prompts; they do not switch the model or provider. Alt+M requires an interactive TTY.

Architect and Correct can be discovered on demand by the model, which is not guaranteed to select them. create-verification-skill remains explicitly triggered to avoid accidental configuration generation. Retry Limit caps repeated failures for the same tool and same arguments; normal debugging with different arguments is not treated as the same failure. Automatic handoff remains off unless explicitly authorized.

resume_interrupted_task searches for interrupted work in the current working directory. It proceeds only when there is one candidate and after confirmation to pass the original request and tool summary to the current model. It rereads the record and checks state; it does not rerun commands, start processes, or restore files automatically.

verification_status reports checks observed in the current turn. Evidence stores only necessary tool results and a limited Git fingerprint; it cannot cover every non-Git state or external change. Quality gates report supported checks that were actually observed. Missing or unknown evidence is unverified.

checkpoint_preview previews checkpoints with verifiable sources and the proposed restore scope. It does not modify working files or the regular index. Actual restore still requires an explicitly authorized existing command. Restore checks the source, paths, and current file state; it is not a multi-file transaction or OS isolation.

LSP, Diff Review, command guards, and Checkpoints provide assistance and safeguards; they do not elevate permissions automatically. Diff Review limits output. Narrow the review scope when it reports truncation.

### Local verification

Core checks without a model call:

    pwsh -NoProfile -File scripts/accept-v03.ps1 -SkipModel

Other existing checks:

    node --test tests/*.test.mjs
    pwsh -NoProfile -File scripts/verify-project.ps1 -Suite sql
    pwsh -NoProfile -File scripts/verify-project.ps1 -Suite dotnet
    pwsh -NoProfile -File scripts/verify-project.ps1 -Suite vue
    node tests/fullstack-fixture.mjs

The full-stack fixture uses temporary Vue, ASP.NET Core API, and SQLite synthetic data. It exercises browser interaction through to rendered UI and independently checks database state. It does not connect to a production database, certify every deployment environment, or act as an OS sandbox. If an SDK, test dependency, or browser is missing, record the check as unverified; do not change the test expectations.

### Security and limits

This project is not an OS sandbox. Scripts and third-party packages run with the current user's privileges; tests use synthetic data only. Do not add API keys, tokens, private sessions, company data, or raw private acceptance output to the public repository. Actions remain disabled; local validation does not require cloud CI. The tooling does not guarantee zero cost; check provider and model charges before using them.
