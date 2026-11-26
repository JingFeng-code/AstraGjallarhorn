using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Services.AddSingleton<NoteRepository>();
builder.Services.AddSingleton<NoteService>();
var app = builder.Build();

var webRoot = Environment.GetEnvironmentVariable("ASTRA_WEB_ROOT")
    ?? throw new InvalidOperationException("Fixture web root missing");
using var files = new PhysicalFileProvider(webRoot);
app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = files });
app.UseStaticFiles(new StaticFileOptions { FileProvider = files });

app.MapPost("/api/notes", async (CreateNote request, NoteService service) =>
{
    var note = await service.CreateAsync(request.Title);
    return note is null
        ? Results.BadRequest(new { error = "Title must contain 1 to 40 characters." })
        : Results.Created($"/api/notes/{note.Id}", note);
});
app.MapGet("/api/notes/{id:int}", async (int id, NoteService service) =>
{
    var note = await service.LoadAsync(id);
    return note is null ? Results.NotFound() : Results.Ok(note);
});
app.Lifetime.ApplicationStarted.Register(() =>
    Console.WriteLine("ASTRA_READY " + app.Urls.Single()));
await app.RunAsync();

internal sealed record CreateNote(string? Title);
internal sealed record Note(int Id, string Title);
