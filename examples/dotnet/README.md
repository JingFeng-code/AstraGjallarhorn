# C# 工程驗證範例

使用 .NET 10 SDK，在儲存庫根目錄執行。

```powershell
dotnet restore examples/dotnet/Notes.Tests.csproj --locked-mode
dotnet build examples/dotnet/Notes.Tests.csproj --no-restore
dotnet test examples/dotnet/Notes.Tests.csproj --no-build
```

建置執行 Roslyn 分析，會拒絕可宣告為 static 的實例成員（CA1822）。xUnit 驗證透過實際記憶體儲存實作寫入及讀回一筆 Note。ArchUnitNET 驗證領域層無儲存層相依。兩條命令均由 Windows CI 執行，錯誤回傳非零。

可以用暫存副本重現各關卡的失敗。每次變更前後使用相同指令驗證。

| 注入變更 | 預期 |
|---|---|
| 將 `NoteStore.Save` 的 `return id;` 改成 `return "wrong";` | 建置失敗（CS0029） |
| 在 `NoteStore` 加入 `public int Version() => 1;` | 建置失敗（CA1822） |
| 在 `Note` 新增 `public static Notes.Storage.NoteStore CreateStore() => new();` | 建置通過，架構測試失敗 |
| 將 `NoteStore.Load` 的回傳值改為 `notes[id] with { Title = "wrong" }` | 建置通過，整合測試失敗 |
