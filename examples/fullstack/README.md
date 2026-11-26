# 跨層除錯合成試點（Phase 4D-1）

目標不是讓模型事先知道錯誤檔案，而是從使用者現象驗證完整資料流。這一階段先驗證測試基礎，尚未啟用 Pi 品質關卡。

流程：Vue 3 表單 → 真實 POST /api/notes → ASP.NET Core Minimal API → NoteService → NoteRepository → 暫存 SQLite → GET /api/notes/{id} → Vue 畫面。驗證器直接以唯讀 SQLite 連線對帳資料，不依賴 API 回應作為唯一證據。

測試使用原有 Vue 依賴與 .NET 10.0.401 SDK；以 Node 24 內建 SQLite 作為合成 Repository 的本機 subprocess adapter，不是 EF Core 實作。避免此階段引入新 NuGet 套件或操作真實資料庫。ASP.NET Core shared framework 由既有 SDK 提供；空本機 feed 還原，缺少 SDK/快取/Edge 即阻塞。

驗收：正常 → 注入服務層標題正規化缺陷 → 還原；三次都用瀏覽器實際送出、HTTP 回應、讀回、DB 獨立查詢、畫面及超長資料拒絕來驗證。只修改暫存副本，API 僅監聽動態 localhost port，使用暫存 DB 和瀏覽器 profile；關閉程序並清理暫存。不修改正式環境、外部資料、Pi 設定或其他 Agent；不是 OS sandbox。新 CI 須通過後才規劃跨層品質契約及真實模型驗收。

下一步的跨層契約必須核准多個候選 implementation path，而不是把唯一錯誤檔案透露給模型；保護測試、依賴、schema/專案設定及驗證器（若要修 schema 則需另行明確核准）。根因報告需能用 HTTP request/response、DB 對帳與最後修改證據說明。EF Core/Oracle/PostgreSQL/MSSQL 仍未驗證，正式整合需獨立評估現有套件與專案授權。
