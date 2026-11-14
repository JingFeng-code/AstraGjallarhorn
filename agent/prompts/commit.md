---
description: 依目前 diff 建立 commit（不 push）
argument-hint: "[訊息方向]"
---
檢查 `git status` 與 `git diff`（含 staged / unstaged），只提交本次相關變更。
不要提交 `.env`、憑證、金鑰、快取、產物或不相關的檔案。

依 Conventional Commits 產生訊息，方向：${1:-依變更內容}
不要 push、不要 amend、不要 reset、不要 force。

完成後回報：commit SHA、commit message、變更檔案數。
