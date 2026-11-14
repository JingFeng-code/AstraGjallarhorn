---
description: 跑專案的測試、型別檢查與 lint，修正到通過
argument-hint: "[範圍或套件]"
---
先讀專案設定（`package.json`、`pyproject.toml`、`Makefile`、`justfile` 等），找出這個專案實際的 test、typecheck、lint 指令。範圍：${1:-整個專案}

依序執行；失敗時讀完整錯誤、修正根因、重跑，直到通過或需要我決定。
不要只跑一個指令就說「驗證完成」；最後列出：

- 執行的指令
- 通過／失敗數
- 剩餘風險或未驗證項目
