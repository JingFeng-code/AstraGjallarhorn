# AstraGjallarhorn

## 名稱由來｜Astra Mythos 神器系列

GitHub 儲存庫為 [JingFeng-code/AstraGjallarhorn](https://github.com/JingFeng-code/AstraGjallarhorn)。

- **神器原型**：北歐神話中海姆達爾的號角 Gjallarhorn。
- **傳說中的能力與考證界線**：在傳說中能響徹眾界、發出警訊；不代表軟體已提供即時廣播功能。
- **軟體對應能力（現代品牌比喻）**：跨設備傳遞已核對的設定及訊號。
- **實際產品定位**：Pi Coding Agent 的受控跨電腦設定同步。
- **技術相容性**：`pi-config` 路徑及指令、備份與安全規則維持不變。

**全系列命名規範的唯一維護來源**：[Astra Mythos｜神器系列品牌規範](https://github.com/JingFeng-code/AstraLore/blob/main/06-%E5%8F%83%E8%80%83/Astra-Mythos/ASTRA_MYTHOS.md)，位於工程筆記庫 AstraLore；本專案不另存品牌規範副本。

---

Pi Agent 的可攜設定同步專案：把「跨電腦可重建」的設定放進 Git，憑證與機器狀態永遠留在本機。

- 來源電腦：Windows + Pi Agent 1.6.0（`@earendil-works/pi-coding-agent`）
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
- Session 模式儲存在 Pi 對話紀錄。`mode-state.json` 仍可提供尚無模式紀錄時的本機預設，套用時會保留。
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
| Pi Agent | 與 `manifests/packages.json` 的 `pi.compatible` 相符（本次在 Windows 實測 `1.6.0`） |
| Node.js | Pi 可執行即可（不需要另外安裝套件） |
| Pi 套件 | `pi-agnes-tools`、`pi-ollama-cloud`（固定版號，見 `manifests/packages.json`） |

本專案**不會**升級 Pi 核心。

---

## 3. 電腦 B 首次安裝

以下假設儲存庫已存在於 GitHub Private，且 `pi` 已可執行。

```powershell
# 1) 取得儲存庫（僅複製，不動既有設定）
git clone https://github.com/JingFeng-code/AstraGjallarhorn.git "$HOME\Documents\pi-config"
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
- 新增缺少的受管套件宣告，並將既有受管項目固定至清單版本。保留資源篩選、其他設定及 Provider 認證。遇到重複宣告會中止。
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

還原會先核對套用後的 SHA-256。任何待還原檔案出現衝突時，實際還原回傳 3 並在寫入前停止。舊備份仍可預覽，但缺少套用後雜湊的變動檔案也視為衝突。若已逐一比對並另行備份本機修改，才使用 `-Restore -Apply -Force`。

還原會：

- 把備份中的檔案寫回。
- 刪除「備份當下不存在」的檔案（即這次新增的），並清掉因此變空的目錄。
- 還原 `settings.json`。
- **不碰** `auth.json`（它從來不在備份與同步範圍）。

完全移除本方案（回到沒有 mode-switch 的 Pi）：

1. 刪除 `$HOME\.pi\agent\extensions\mode-switch.ts`
2. 刪除 `$HOME\.pi\modes\`
3. 保留 `$HOME\.pi\agent\mode-state.json` 與既有 Session。
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
| `ds-*` 沒出現 | 執行 `/mode use deep-execution`，再用 `/mode status` 檢查 |
| Alt+M 沒反應 | 需在 Pi 互動介面（TTY）；`verify.ps1` 只能做靜態檢查 |
| Pi 版本不同 | 本專案不升級核心；請自行升級 Pi 或調整 `manifests/packages.json` |
| 套件安裝失敗 | `pi list` 檢查來源；確認 npm registry 可連線 |

---

## 10. 授權與來源

- `modes/deep-execution/skills/ds-*`：來自 [deepseek-stack](https://github.com/aicodeking/deepseek-stack)（MIT），
  匯入 `main` 提交 `d4f1ebe72e8314c3a0c6135bb82f623c650f7218`（2026-10-28）。
  授權文件保留於 `modes/deep-execution/deepseek-stack-LICENSE`。
- `extensions/mode-switch.ts`：本專案自製。

## 工程驗證範例

`/retry-limit on` 在同一回合第三次相同失敗工具呼叫後中止。若同一工具反覆用不同參數失敗，可明確選擇 `/retry-limit strict`，在同工具連續第三次失敗時中止。Strict 也會計入連續的故障注入，需保留測試時請先關閉。`/retry-limit status` 查詢，`/retry-limit off` 關閉。設定隨 Session 保留，沒有設定的新 Session 預設關閉，每次新回合重置計數。

`/retry-limit handoff` 取出這個 Session 最近的停止摘要，供手動交接。摘要只包含工具、停止原因和呼叫 ID。擴充功能監聽 Pi 的工具執行事件，涵蓋已驗證的不存在工具錯誤及 shell 非零退出碼。

### Hashline 編輯

正式 Pi 已採用 `pi-better-edit@2.21.0`。模型的 `read` 會回傳行錨點，`edit` 使用目前工具 schema 的 `file`、`anchor_from`、`anchor_to`、`text`。單行替換時兩個端點應為同一錨點。工具拒絕舊錨點時，重新讀取再編輯。既有 `/hashline` 與 `/hashreplace` 仍提供使用者明確呼叫的整檔快照保護。

在 Pi 輸入 `/hashline {"file":"examples/sql/001-create-notes.sql","start":1}`，取得整檔 SHA-256 及行錨點。複製實際回傳的值到下列命令。省略 `last` 只替換一行，`lines: []` 移除指定範圍。

```text
/hashreplace {"file":"examples/sql/001-create-notes.sql","hash":"<SHA-256>","first":"<第一行錨點>","last":"<最後一行錨點>","lines":["<新內容>"]}
```

僅接受目前目錄內、至多 1 MiB 的 UTF-8 檔案。讀取每次最多顯示 50 行，每行預覽至 300 字元。檔案任何位元組改變時需重新讀取。寫入前會再比對雜湊，並以同目錄暫存檔替換；這個檢查與替換之間仍有極短的競爭視窗，使用同一檔案的獨立寫入程序需要協調。

### 工具設定

`/tool-profile local` 保留初始工具中的 `read`、`edit`、`write`、`bash`。 `/tool-profile cloud` 保留 `read`、`edit`、`write`。 `/tool-profile review` 保留 `read`、`grep`、`find`、`ls` 中原本啟用的項目。 `/tool-profile status` 顯示清單，`/tool-profile restore` 恢復切換前集合。

這些指令只調整目前 Pi 擴充實例的模型工具。模型與 Thinking Level 由原生選擇器獨立管理。Review 限制模型工具，使用者仍可執行手動命令，亦不構成程序隔離。

從儲存庫根目錄執行 `pwsh -NoProfile -File scripts/verify-project.ps1`。只需驗證一組時，加上 `-Suite sql`、`-Suite dotnet` 或 `-Suite vue`。先按各範例說明準備依賴。命令遇到第一個失敗便回傳該步驟的退出碼。

在 Pi 裡，`/verify` 提供驗證和失敗交接指引。可用 `!pwsh -NoProfile -File scripts/verify-project.ps1` 直接執行，不消耗模型請求。三個 Windows CI 工作各執行相同入口的一組測試。PR 是否強制要求這些工作通過，取決於 GitHub 的分支規則。

[SQLite 驗證範例](examples/sql/README.md)提供可獨立執行的 migration、schema 與欄位限制驗證，以及四項故障注入回歸。Windows CI 執行相同命令。

[C# 驗證範例](examples/dotnet/README.md)提供 Roslyn 分析、xUnit 整合測試與 ArchUnitNET 依賴方向檢查。

[Vue／TypeScript 驗證範例](examples/vue/README.md)提供 ESLint、vue-tsc、Vitest、Vite 建置及 Playwright 瀏覽器驗證。

Pi 的 `/skill:architect <設計題目>` 比較模組邊界與相依方向。此技能只在明確呼叫時載入。來源為 [pstack 固定版本](https://github.com/cursor/plugins/tree/41e400932eca14f289e7db717a70455256b6d388/pstack/skills/architect)，MIT 授權隨檔同步。

`/skill:create-verification-skill <已實測的命令、工作目錄、成功與失敗退出碼>` 產出可審查的 Markdown 草稿。驗證草稿中的原樣命令後，再存入專案的 `.pi/skills/<name>/SKILL.md`。這是 [pstack](https://github.com/cursor/plugins/tree/41e400932eca14f289e7db717a70455256b6d388/pstack) 的精簡 Pi 適配，使用明確呼叫、相對路徑及實際退出碼，附 MIT 授權。

`/skill:correct <重現命令、失敗證據及目標檔案>` 引導根因修復。使用 Better Edit 替換一行時，把實際的同一錨點放進兩個端點，複製目標行後只改出錯的值。保留既有回歸驗證，並以原命令確認修正。

Plan 審查可向 Pi 提供計畫與需求。Diff 審查見下方「Diff Review」：模型用唯讀的 `review_diff` 自行取得 staged／unstaged diff，不再需要手動貼上。

Checkpoint 已自動化，見下方「自動 Checkpoint」。手動 `git stash push --include-untracked` 流程仍可用，但不再是建議做法。

---

## 11. v0.2 完整能力

v0.2 把下列能力加入正式 Pi。全部是第一方擴充功能（`extensions/*.js`，由 `manifests/pi-config.json` 同步）。逐項驗收證據見 [能力驗收](docs/verification/capability-completion.md#v02-release-closure)，完整操作見 [操作手冊](docs/operations-manual.md)。

| 能力 | 擴充功能 | 指令 | 預設 |
|---|---|---|---|
| TypeScript／C# LSP | `lsp.js` | 工具 `lsp_diagnostics`、`lsp_definition`、`lsp_references`；`/lsp status|stop` | 開，伺服器不自動下載 |
| 通用安全指令防護 | `command-guard.js` | `/guard status|enforce|strict|off|allow <dir>|clear` | enforce |
| 自動 Checkpoint | `checkpoint.js` | `/checkpoint status|on|off|now|list|diff <id>|restore <id> [--apply] [--force]` | 開 |
| 任務恢復與 Timeout | `task-recovery.js` | `/task status|list|resume|discard|timeout <分鐘>|orphans [kill]` | 開，Timeout 關 |
| Herdr 自動交接 | `handoff.js` | `/handoff-auto on <terminal> --no-extra-cost|off|status|check` | **關**（手動交接） |
| Diff Review | `diff-review.js` | 工具 `review_diff`；`/review-diff [重點]` | Review 工具設定包含 |

### LSP

- TypeScript：`typescript-language-server@6.1.0` 與 `typescript@5.9.3` 固定安裝在 Pi 私有目錄 `~/.pi/agent/lsp`（兩個套件、零依賴、`npm audit` 0 筆）。安裝：`npm install --prefix "$env:USERPROFILE/.pi/agent/lsp" --ignore-scripts --save-exact --no-audit --no-fund typescript@5.9.3 typescript-language-server@6.1.0`。`verify.ps1` 檢查版本。
- C#：使用 Microsoft C# VS Code 擴充功能（`ms-dotnettools.csharp`）隨附、有 Authenticode 簽章的 Roslyn Language Server，從 `~/.vscode/extensions/ms-dotnettools.csharp-*/.roslyn` 或環境變數 `ASTRA_ROSLYN_LS` 找到。已用 2.160.4 與 .NET SDK 10.0.401 實測。找不到時工具回報 NOT FOUND，不會下載。
- 診斷結果有三種：`ERRORS`／`CLEAN`／`INCONCLUSIVE`。只有伺服器對目前檔案內容明確回報空清單才是 `CLEAN`；沒有回應就是 `INCONCLUSIVE`，不可當作通過，改用專案編譯指令。
- 每次呼叫都從磁碟重新同步文件，所以 Better Edit、Hashline、bash 或外部程式的修改都看得到。
- Roslyn 的自動 NuGet restore 被關閉，專案需先自行 `dotnet restore`。工具只接受工作目錄內的檔案，伺服器程序在 Pi 結束、`/lsp stop` 或閒置 10 分鐘後終止。

### 通用安全指令防護

`command-guard.js` 在每次 `bash`、`write`、`edit`、`read` 工具呼叫前，用確定性規則判斷：允許、需要人工核准（`ask`）或拒絕（`deny`）。無法判斷且風險高的呼叫走 `ask`；沒有互動介面時 `ask` 視為拒絕。`/guard strict` 讓所有 `ask` 直接拒絕。

- 拒絕：工作目錄與 `/guard allow` 授權目錄以外的寫入或刪除、整個根目錄／家目錄刪除、其他 Agent 設定（`~/.claude`、`~/.codex`、`~/.config/opencode`、`herdr`、專案內 `.claude`／`.codex`／`.opencode`）的修改、Pi 自己的 `settings.json` 與防護擴充、憑證與金鑰（`auth.json`、`.ssh`、`.aws`、`.npmrc`、`.git-credentials`…）、`git config --global`、登錄檔／服務／排程／防火牆等系統設定、`curl … | sh`。
- 需核准：`git reset --hard`、`clean -f`、`checkout .`、強制推送、刪除分支或 stash、`rebase`、遞迴／萬用字元／大量刪除、全域套件安裝（`npm -g`、`pip`、`winget`…）、`eval`、`bash -c` 內含可疑指令、`-EncodedCommand`、計算出的指令名稱、上傳本機資料的 `curl`、專案內 `.env`。
- 允許：一般 `git status/diff/log/add/commit`、`npm test/ci/run`、`dotnet build/test`、`eslint`、`tsc`、專案內的檔案讀寫。
- 它解析指令文字，會處理 `;` `&&` `||` `|`、引號、`$()`、反引號、`bash -c`、`pwsh -Command`、`cmd /c`、`env`、`timeout`、`xargs`、`cd` 後的相對路徑。**它不是 OS Sandbox**：執行檔案（`node script.js`）時看不到腳本內容；變數展開、別名與模型想像不到的繞法可能漏掉。需要硬隔離時請使用容器、VM 或 Windows Sandbox。

### 自動 Checkpoint

每個任務開始前（`agent_start`）與結束時，`checkpoint.js` 用私有暫存 index 把整個工作樹（含 untracked，遵守 `.gitignore`）寫成 `refs/astra/checkpoints/<id>/pre|post`。不碰你的 index、分支、stash 或檔案；失敗只提醒，任務照常進行（`ASTRA_CHECKPOINT_TIMEOUT_MS` 預設 30 秒）。保留最近 30 個。

- 任務開始時若發現工作樹自上次任務後被外部改動，會列出檔案。
- `/checkpoint restore <id>` 預設只預覽：只列出「這個任務改變的路徑」。任務結束後又被別人改過的檔案標為 SKIP，除非加 `--force`。不屬於任務的修改（其他 Agent 的檔案）永遠不碰。加 `--apply` 才寫入，並先建立 `<id>-before-restore` 安全 Checkpoint。
- 還原到的是**任務開始前**的狀態（包含你當時未提交的修改），不是 `HEAD`。
- 限制：多個 Agent 同時修改同一個工作樹時無法分辨誰改了哪個檔案；真正隔離請給每個 Agent 獨立的 git worktree。

### 任務恢復

`task-recovery.js` 在 `~/.pi/agent/tasks/` 保存任務日誌（提示、每個工具呼叫與結果、擁有者程序）。Pi 異常結束後，新 Pi 在同一目錄啟動時把持有者已死的任務標為 `interrupted` 並提醒。`/task resume` 不會假設任何作業系統程序可原地恢復，而是把已完成的呼叫、結果未知的呼叫（標示「可能已改變狀態」或「唯讀可重做」）與規則交給模型：先檢查真實狀態，不重做已完成工作，不盲目重跑有外部副作用的操作。同一任務只能續接一次（`--again` 需人工確認），並用鎖防止兩個 Pi 同時續接。`/task timeout <分鐘>`（或 `ASTRA_TASK_TIMEOUT_MIN`）逾時取消，`/task orphans` 列出死亡 Pi 留下的子程序，`kill` 需確認。

### Herdr 自動交接

預設關閉，需要 `/retry-limit on`（或 `strict`）搭配。`/handoff-auto on t12 --no-extra-cost` 先檢查接收者存在、活著、閒置、工作目錄與目前相同，記錄它的 Agent 種類，再啟用。第三次符合條件的失敗讓 Pi 停止後：寫摘要檔到 `~/.pi/agent/handoffs/`（任務、失敗呼叫、git 狀態、Checkpoint），用 `hc send <terminal> "<短指令>" --if idle` 通知接收者，並確認接收者的狀態變為 working 或 turn 增加才算接收。任何一步失敗都保留摘要並停止，**不重試**。

`--no-extra-cost` 是你對接收者不產生額外費用的聲明；擴充功能無法從 hc 得知計費，只在送出前確認接收者的 Agent 種類沒有被換掉。防止重複：每次失敗只送一次（帳本記錄「送出中」，崩潰後也不重送）；接收者的任務若帶有交接標記則不會再交接（防循環）；每小時最多 3 次。不修改 Herdr、hc 或其他 Agent 的設定。

### Diff Review

`review_diff` 只執行固定的 git 讀取命令：staged diff、unstaged diff、untracked 清單與範圍報告（變更檔案、有原始碼變更卻沒有測試變更的 `REGRESSION-TEST GAP`、部分暫存）。結果附上工作樹指紋，審查前後不同會標為錯誤。`/review-diff [重點]` 暫時把工具限縮為 `read`、`grep`、`find`、`ls`、`review_diff` 並要求模型對照專案的 `AGENTS.md` 檢查架構規則，結束後恢復原工具。
