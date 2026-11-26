using System.Text.RegularExpressions;

internal sealed class NoteService(NoteRepository repository)
{
    public async Task<Note?> CreateAsync(string? raw)
    {
        if (raw is null) return null;
        var title = Regex.Replace(raw.Trim(), @"\s+", " ");
        if (title.Length is < 1 or > 40) return null;
        return await repository.SaveAsync(title);
    }

    public Task<Note?> LoadAsync(int id) => repository.LoadAsync(id);
}
