using Notes.Domain;

namespace Notes.Storage;

internal sealed class NoteStore
{
    private readonly Dictionary<int, Note> notes = new();

    public int Save(Note note)
    {
        int id = notes.Count + 1;
        notes.Add(id, note);
        return id;
    }

    public Note Load(int id) => notes[id];
}
