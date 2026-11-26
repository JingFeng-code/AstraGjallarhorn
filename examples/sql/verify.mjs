import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const migration = process.argv[2] ?? new URL("001-create-notes.sql", import.meta.url);
const database = new DatabaseSync(":memory:");

try {
  assert.equal(database.prepare("PRAGMA user_version").get().user_version, 0);
  database.exec(readFileSync(migration, "utf8"));
  assert.equal(database.prepare("PRAGMA user_version").get().user_version, 1, "migration version");
  const columns = database.prepare("PRAGMA table_info(notes)").all();
  assert.deepEqual(
    columns.map(({ name, type, notnull, pk }) => ({ name, type, notnull, pk })),
    [
      { name: "id", type: "INTEGER", notnull: 0, pk: 1 },
      { name: "title", type: "TEXT", notnull: 1, pk: 0 },
    ],
    "notes schema",
  );

  const insert = database.prepare("INSERT INTO notes (title) VALUES (?)");
  const title = "測".repeat(40);
  const { lastInsertRowid } = insert.run(title);
  assert.equal(database.prepare("SELECT title FROM notes WHERE id = ?").get(lastInsertRowid).title, title);
  for (const invalidTitle of ["", "測".repeat(41)]) {
    assert.throws(
      () => insert.run(invalidTitle),
      /CHECK constraint failed/,
      "title length constraint",
    );
  }
  console.log("PASS: migration, schema version, columns, and title length");
} finally {
  database.close();
}
