# SQLite 驗證範例

在儲存庫根目錄以 Node.js 24 執行。資料庫建立於記憶體中，程序結束即銷毀。

```powershell
node examples/sql/verify.mjs
node --test examples/sql/verify.test.mjs
```

第一條指令實際執行 migration，核對 schema 版本和欄位定義，再寫入並讀回 40 個字元的標題。空字串及 41 個字元的標題必須由資料庫約束拒絕。成功回傳 0，驗證錯誤回傳非零。

第二條指令對四個暫存 migration 副本分別注入語法、欄位型別、schema 版本及長度限制錯誤。每一項都要求退出碼依序為 0、1、0，並核對失敗診斷。GitHub Actions 在 Windows 執行兩條指令。合併時是否強制要求此檢查由儲存庫的分支保護規則決定。
