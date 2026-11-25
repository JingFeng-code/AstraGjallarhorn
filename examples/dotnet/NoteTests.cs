using ArchUnitNET.Loader;
using ArchUnitNET.xUnit;
using Notes.Domain;
using Notes.Storage;
using Xunit;
using static ArchUnitNET.Fluent.ArchRuleDefinition;

namespace Notes.Tests;

public sealed class NoteTests
{
    [Fact]
    public static void DomainDoesNotDependOnStorage()
    {
        var architecture = new ArchLoader().LoadAssemblies(typeof(Note).Assembly).Build();
        Types().That().ResideInNamespace("Notes.Domain").Should()
            .NotDependOnAny(Types().That().ResideInNamespace("Notes.Storage"))
            .Check(architecture);
    }

    [Fact]
    public static void SavedNoteCanBeLoaded()
    {
        var store = new NoteStore();
        var note = new Note("sample");
        var id = store.Save(note);

        Assert.Equal(note, store.Load(id));
    }
}
