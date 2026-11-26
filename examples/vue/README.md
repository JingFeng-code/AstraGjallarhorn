# Vue／TypeScript 工程驗證範例

使用 Node.js 24、npm 及 Windows 上既有的 Microsoft Edge。Playwright 為合成範例開啟暫存瀏覽器設定檔，並在測試結束後關閉預覽服務。從本目錄執行。

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Playwright 對建置結果做真實輸入與送出，驗證畫面顯示的標題，並檢查瀏覽器例外與 console error。它只連線到 `127.0.0.1:4173` 的測試服務。CI 為每道關卡執行獨立命令，保留各關卡的退出碼。

在暫存專案副本逐一注入並還原以下變更，以相同命令驗證故障前後。

| 注入變更 | 預期 |
|---|---|
| 在 `normalizeTitle` 宣告未使用的變數 | ESLint 回傳 1 |
| 把 `normalizeTitle(draft.value)` 改成 `normalizeTitle(404)` | vue-tsc 回傳 2（TS2345） |
| 去掉 `normalizeTitle` 裡的 `.trim()` | Vitest 回傳 1 |
| 在 `save()` 更新標題後拋出 `new Error("synthetic runtime fault")` | 建置通過，Playwright 回傳 1 |
