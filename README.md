# AstraGjallarhorn

## 名稱由來｜Astra Mythos 神器系列

**新品牌顯示名稱：AstraGjallarhorn**。目前 GitHub repository 仍是 [`JingFeng-code/AstraRelay`](https://github.com/JingFeng-code/AstraRelay)；這次僅更新品牌文字，尚未改 GitHub Repository 名稱。

- **神器原型**：北歐神話中海姆達爾的號角 Gjallarhorn。
- **傳說中的能力與考證界線**：在傳說中能響徹眾界、發出警訊；不代表軟體已提供即時廣播功能。
- **軟體對應能力（現代品牌比喻）**：跨設備傳遞已核對的設定及訊號。
- **實際產品定位**：Pi Coding Agent 的受控跨電腦設定同步。
- **技術相容性**：`pi-config` 路徑及指令、備份與安全規則維持不變。

**全系列命名規範的唯一維護來源**：[Astra Mythos｜神器系列品牌規範](https://github.com/JingFeng-code/AstraLore/blob/main/06-%E5%8F%83%E8%80%83/Astra-Mythos/ASTRA_MYTHOS.md)，位於工程筆記庫 AstraLore；本專案不另存品牌規範副本。

---

Pi Agent 的可攜設定同步專案：把「跨電腦可重建」的設定放進 Git，憑證與機器狀態永遠留在本機。

- 來源電腦：Windows + Pi Agent 1.5.2（`@earendil-works/pi-coding-agent`）
- 目標：多台 Windows 電腦以「匯出 → Git → 套用 → 驗證」的受控單向流程同步
- 目前階段：單向同步（不做自動覆寫、不做雙向合併）

---

## 1. 這個儲存庫管什麼

| 目錄 | 內容 | 對應本機路徑（相對於 Pi 家目錄） |
|---|---|---|
| `extensions/mode-switch.ts` | 兩種工作模式的擴充功能（Alt+M 切換） | `agent/extensions/mode-switch.ts` |
| `agent/AGENTS.md` | Pi 全域工作規則（一般模式與深度執行模式都會生效） | `agent/AGENTS.md` |
| `agent/prompts/` | Pi prompt templates：`verify`、`commit`、`review` | `agent/prompts/` |
| `modes/README.md` | 模式使用說明與還原步驟 | `modes/README.md` |
| `modes/deep-execution/instructions.md` | 深度執行模式工作規則 | `modes/deep-execution/instructions.md` |
| `modes/deep-execution/skills/ds-*/` | DeepSeek Stack 7 個 Skills | `modes/deep-execution/skills/` |
| `modes/deep-execution/deepseek-stack-LICENSE` | 上游 MIT 授權 | 同左 |
| `manifests/pi-config.json` | 同步清單（唯一來源） | — |
| `manifests/packages.json` | Pi 版本與固定版號的套件清單（`export.ps1` 產生） | — |
| `manifests/providers.json` | Provider 名稱清單（不含憑證，`export.ps1` 產生） | — |
| `scripts/export.ps1` | 本機 → 儲存庫 | — |
| `scripts/apply.ps1` | 儲存庫 → 本機（預設 Dry Run） | — |
| `scripts/verify.ps1` | 驗證安裝結果與模式行為 | — |

所有路徑都由 `$HOME` 推導（Pi 家目錄 = `$HOME\.pi`），沒有寫死使用者名稱或安裝路徑。
Pi 若設定了 `PI_CODING_AGENT_DIR`，請以 `-PiHome` 指定實際的 Pi 家目錄。

### 絕對不同步的內容

`auth.json`、任何 API Key / Token / Cookie、`mode-state.json`、`trust.json`、
`models-store.json`、Session / 聊天紀錄、快取、Logs、暫存檔、`node_modules`、
未確認來源的第三方套件（含 `pi-profile-switch`）。

理由與防線：

- 憑證屬個人且會輪替，進 Git 等於外洩。
- `mode-state.json` 是各機目前的模式，不該被覆寫。
- `models-store.json` 是 Provider 模型快取（數百 KB），會隨 Provider 而異。
- `.gitignore` 只是第二道防線；`export.ps1` 會在寫入前**主動掃描憑證樣式並中止**。

> `pi-profile-switch` 在本機 Windows 環境無法正常運作，已改用 `mode-switch.ts`，不列入必要套件。

### 為什麼 `settings.json` 不同步

`settings.json` 含 `defaultProvider`、`defaultModel`、`defaultThinkingLevel`、`defaultTools`，以及 Pi 自動寫入的 changelog／裝置狀態；它會隨 `/model`、`/thinking`、`Ctrl+S` 頻繁變動。

本專案**不把 `settings.json` 列入同步 entries**；`apply.ps1` 只在套件缺少時補上 `packages` 宣告，不覆寫模型、thinking、工具或其他設定。

若日後要同步模型預設，請另建 `settings.template.json` 與 merge 腳本，只合併指定的可攜欄位，不要直接同步 raw `settings.json`。

---

## 2. 前置需求

| 項目 | 需求 |
|---|---|
| 作業系統 | Windows 10/11 |
| PowerShell | 7.x（`pwsh`）或 Windows PowerShell 5.1，兩者皆已實測 |
| Git | 2.x，且已設定 `user.name` / `user.email` |
| Pi Agent | 與 `manifests/packages.json` 的 `pi.compatible` 相符（目前 `1.5.x`） |
| Node.js | Pi 可執行即可（不需要另外安裝套件） |
| Pi 套件 | `pi-agnes-tools`、`pi-ollama-cloud`（固定版號，見 `manifests/packages.json`） |

本專案**不會**升級 Pi 核心。

---

## 3. 電腦 B 首次安裝

以下假設儲存庫已存在於 GitHub Private，且 `pi` 已可執行。

```powershell
# 1) 取得儲存庫（僅複製，不動既有設定）
git clone https://github.com/<你的帳號>/pi-config.git "$HOME\Documents\pi-config"
cd "$HOME\Documents\pi-config"

# 2) 先看計畫，不寫入
pwsh -File scripts\apply.ps1

# 3) 實際套用（會先備份到本機）
pwsh -File scripts\apply.ps1 -Apply

# 4) 安裝固定版號的 Pi 套件（需要網路；不升級 Pi 核心）
pi install npm:pi-agnes-tools@0.3.7
pi install npm:pi-ollama-cloud@0.13.1

# 5) 驗證
pwsh -File scripts\verify.ps1
```

套用後重新啟動 Pi（或在 Pi 內執行 `/reload`），即可用 `Alt+M` 切換模式。

`apply.ps1` 的行為：

- 預設 Dry Run；必須加 `-Apply` 才寫入。
- 寫入前把會被覆寫的檔案（含 `settings.json`）備份到
  `$env:LOCALAPPDATA\pi-config\backups\<時間戳>\`。
- 目標檔案已存在、內容不同、且不屬於上次套用紀錄 → **視為衝突並停止**。
- 只「補上」缺少的套件宣告，不覆寫 Provider 認證、不改 `auth.json`、不動 `mode-state.json`。
- Pi 版本不相容時預設警告；加 `-StrictVersion` 則直接中止。

### 首次登入 Provider

`auth.json` 不會被同步。電腦 B 需自行登入：

```powershell
pi auth login agnes
pi auth login ollama-cloud
pi auth login nvidia
```

---

## 4. 日常更新流程

### 電腦 A（修改端）

```powershell
cd "$HOME\Documents\pi-config"

# 1) 匯出（會顯示檔案清單 + Diff，並掃描憑證/硬編碼路徑）
pwsh -File scripts\export.ps1

# 2) 檢查再提交
git status
git diff
git add -A
git diff --cached
git commit -m "sync: <說明這次改了什麼>"
git push
```

`export.ps1` 不會執行任何 git 指令，Push 永遠是人工決定。

### 電腦 B（套用端）

```powershell
cd "$HOME\Documents\pi-config"
git pull

pwsh -File scripts\apply.ps1          # 看計畫
pwsh -File scripts\apply.ps1 -Apply   # 套用
pwsh -File scripts\verify.ps1         # 驗證
```

若 B 曾經手動改過同一個檔案，`apply.ps1` 會停下列出衝突。處理方式：

1. 先備份自己的版本（或直接看 `git diff` 取捨）
2. 確認要採用儲存庫版本後：`pwsh -File scripts\apply.ps1 -Apply -Force`

---

## 5. 回復（Rollback）

每次 `apply.ps1 -Apply` 都會建立備份，並在輸出中直接印出還原指令。

```powershell
# 還原最近一次
pwsh -File scripts\apply.ps1 -Restore -RestoreLatest           # Dry Run
pwsh -File scripts\apply.ps1 -Restore -RestoreLatest -Apply

# 還原指定備份
pwsh -File scripts\apply.ps1 -Restore -RestoreFrom "$env:LOCALAPPDATA\pi-config\backups\20260101-120000" -Apply
```

還原會：

- 把備份中的檔案寫回。
- 刪除「備份當下不存在」的檔案（即這次新增的），並清掉因此變空的目錄。
- 還原 `settings.json`。
- **不碰** `auth.json`（它從來不在備份與同步範圍）。

完全移除本方案（回到沒有 mode-switch 的 Pi）：

1. 刪除 `$HOME\.pi\agent\extensions\mode-switch.ts`
2. 刪除 `$HOME\.pi\modes\`
3. 刪除 `$HOME\.pi\agent\mode-state.json`
4. 重新啟動 Pi

---

## 6. 腳本參考

### `scripts/export.ps1`

| 參數 | 說明 |
|---|---|
| `-DryRun` | 只顯示計畫與 Diff |
| `-NoDiff` | 不顯示 Diff |
| `-Prune` | 刪除儲存庫中已不存在的同步檔案 |
| `-RepoPath` | 指定儲存庫路徑（預設為腳本上一層） |
| `-PiHome` | 指定 Pi 家目錄（預設 `$HOME\.pi`，供演練用） |

流程：展開清單 → 憑證掃描 → 硬編碼路徑掃描 → Skills 相依檢查 → 比對/Diff → 寫入 → 寫入後複驗。
任何掃描發現問題都會在**寫入前**中止。

### `scripts/apply.ps1`

| 參數 | 說明 |
|---|---|
| （無） | Dry Run，顯示新增/更新/衝突 |
| `-Apply` | 實際寫入 |
| `-Force` | 衝突仍覆寫（仍先備份） |
| `-InstallPackages` | 對版本不符的套件執行 `pi install <pin>` |
| `-StrictVersion` | Pi 版本不相容時中止 |
| `-Restore -RestoreLatest` / `-RestoreFrom <dir>` | 還原 |
| `-PiHome` | 指定 Pi 家目錄 |

衝突判定依據 `$env:LOCALAPPDATA\pi-config\applied.json`（每個 Pi 家目錄一份紀錄）：

| 情況 | 判定 |
|---|---|
| 目標不存在 | 新增 |
| 目標與儲存庫相同 | 相同（略過） |
| 目標不同，且等於上次套用的雜湊 | 更新（安全） |
| 目標不同，且與上次套用不同 | 衝突（本機已修改） |
| 目標存在但沒有套用紀錄 | 衝突（非本專案管理） |

沒有變更的檔案也會記入套用紀錄（代表「本機狀態等同儲存庫」），
所以之後儲存庫更新時會被判定為安全更新，而不是衝突。
紀錄遺失（例如清掉 `$env:LOCALAPPDATA\pi-config`）不會刪除任何設定，
只會讓下次套用對「內容不同」的檔案改為要求確認。

### `scripts/verify.ps1`

| 參數 | 說明 |
|---|---|
| `-SkipModeTest` | 不做 Pi RPC 模式載入測試 |
| `-PiHome` | 指定 Pi 家目錄 |

離開代碼：`0` 通過（可有 WARN/MANUAL）、`1` 有 FAIL、`2` 環境錯誤。

驗證 15 項：Pi 版本、11 個同步檔案、`mode-switch.ts`、套件版本、
`instructions.md`、`ds-*` 不在自動掃描目錄、深度執行 7 個 `ds-*`、
`/mode` 指令註冊、`ds-*` 來源、一般模式隔離、本機 Provider 基準、
`auth.json` 未被同步、`registerShortcut('alt+m')`、Alt+M 實際切換（人工）、
`mode-state.json`。

模式載入測試用 **Pi RPC**（`pi --mode rpc --no-session` + `get_commands`）：
不需要 TTY、不呼叫模型、不花費 Token。測試使用暫存 agent 目錄，
**不會切換你目前的模式**。

---

## 7. 模式與 Skills 的載入機制

- `ds-*` Skills 放在 `$HOME\.pi\modes\deep-execution\skills\`，**不在** Pi 的任何自動掃描目錄。
- `mode-switch.ts` 只在 `deep-execution` 模式回應 `resources_discover` 事件，回傳該目錄，
  因此一般模式完全看不到 `ds-*`。
- 深度執行的 `instructions.md` 由 `before_agent_start` 事件附加到系統提示。
- 模式只影響 Skills 與系統提示，不改 Provider、Model、Thinking Level、Tools 或 Session。

驗證這個行為的方式（不用切換模式）：

```powershell
pwsh -File scripts\verify.ps1
```

---

## 8. 安全規則（本專案的硬性約束）

1. 憑證、Token、Cookie、Session 一律不進版控。
2. `.gitignore` 不是唯一防線：`export.ps1` / `apply.ps1` 都會主動掃描並中止。
3. 禁止硬編碼使用者家目錄路徑；一律使用 `$HOME`、`~` 或相對於 Pi 家目錄的路徑。
4. 不跟隨來源的符號連結 / Junction（`export.ps1` 遇到即中止）。
5. `apply.ps1` 預設 Dry Run；衝突預設停止。
6. 不升級 Pi 核心，不安裝未在 `manifests/packages.json` 列出的套件。
7. 儲存庫必須是 **Private**。
8. 本專案不影響 Claude Code、Codex、OpenCode、Herdr 的設定（只操作 `$HOME\.pi` 下的白名單路徑）。

---

## 9. 疑難排解

| 症狀 | 處理 |
|---|---|
| `apply.ps1` 說衝突 | 先看 `git diff`，決定保留哪一版；確定採用儲存庫版才加 `-Force` |
| `verify.ps1` 說檔案不同 | 可能是本機手改，或儲存庫還沒 `git pull`；先 `git pull` 再驗證 |
| `ds-*` 沒出現 | 確認 `mode-state.json` 為 `deep-execution`，並 `/reload` 或重啟 |
| Alt+M 沒反應 | 需在 Pi 互動介面（TTY）；`verify.ps1` 只能做靜態檢查 |
| Pi 版本不同 | 本專案不升級核心；請自行升級 Pi 或調整 `manifests/packages.json` |
| 套件安裝失敗 | `pi list` 檢查來源；確認 npm registry 可連線 |

---

## 10. 授權與來源

- `modes/deep-execution/skills/ds-*`：來自 [deepseek-stack](https://github.com/aicodeking/deepseek-stack)（MIT），
  匯入 `main` 提交 `d4f1ebe72e8314c3a0c6135bb82f623c650f7218`（2026-10-28）。
  授權文件保留於 `modes/deep-execution/deepseek-stack-LICENSE`。
- `extensions/mode-switch.ts`：本專案自製。
