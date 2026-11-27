import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const [file, operation] = process.argv.slice(2);
if (!file || !["save", "load"].includes(operation)) throw Error("Invalid fixture adapter invocation");
const input = JSON.parse(readFileSync(0, "utf8"));
const db = new DatabaseSync(file);
try {
  db.exec(readFileSync(new URL("schema.sql", import.meta.url), "utf8"));
  if (operation === "save") {
    const id = Number(db.prepare("INSERT INTO notes (title) VALUES (?)").run(input.title).lastInsertRowid);
    console.log(JSON.stringify(db.prepare("SELECT id, title FROM notes WHERE id = ?").get(id)));
  } else {
    console.log(JSON.stringify(db.prepare("SELECT id, title FROM notes WHERE id = ?").get(input.id) ?? null));
  }
} finally {
  db.close();
}
