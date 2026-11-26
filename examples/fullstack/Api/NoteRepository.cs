using System.Diagnostics;
using System.Text.Json;

// Dependency-free synthetic adapter; not EF Core or a production repository.
internal sealed class NoteRepository
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<Note> SaveAsync(string title) =>
        await ExecuteAsync("save", new { title })
        ?? throw new InvalidOperationException("Missing saved note");

    public Task<Note?> LoadAsync(int id) => ExecuteAsync("load", new { id });

    private static async Task<Note?> ExecuteAsync(string operation, object input)
    {
        var node = Environment.GetEnvironmentVariable("ASTRA_NODE")
            ?? throw new InvalidOperationException("Fixture Node executable missing");
        var adapter = Environment.GetEnvironmentVariable("ASTRA_DB_ADAPTER")
            ?? throw new InvalidOperationException("Fixture adapter missing");
        var db = Environment.GetEnvironmentVariable("ASTRA_DB")
            ?? throw new InvalidOperationException("Fixture database missing");

        var start = new ProcessStartInfo(node)
        {
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        start.ArgumentList.Add(adapter);
        start.ArgumentList.Add(db);
        start.ArgumentList.Add(operation);
        using var process = Process.Start(start)
            ?? throw new InvalidOperationException("Cannot start fixture adapter");
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        try
        {
            var stdout = process.StandardOutput.ReadToEndAsync(deadline.Token);
            var stderr = process.StandardError.ReadToEndAsync(deadline.Token);
            await process.StandardInput.WriteAsync(JsonSerializer.Serialize(input, JsonOptions));
            process.StandardInput.Close();
            await process.WaitForExitAsync(deadline.Token);
            var result = await stdout;
            var diagnostic = await stderr;
            if (process.ExitCode != 0)
                throw new InvalidOperationException("Fixture adapter failed: " + diagnostic);
            return JsonSerializer.Deserialize<Note?>(result, JsonOptions);
        }
        catch
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            throw;
        }
    }
}
