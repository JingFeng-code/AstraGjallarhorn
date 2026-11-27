import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const verify = fileURLToPath(new URL("verify.mjs", import.meta.url));
const migration = readFileSync(new URL("001-create-notes.sql", import.meta.url), "utf8");

for (const [label, original, injected, error] of [
  ["syntax", "CREATE TABLE", "CREAT TABLE", /syntax error/],
  ["column type", "title TEXT", "title INTEGER", /notes schema/],
  ["migration version", "user_version = 1", "user_version = 2", /migration version/],
  ["field length", "BETWEEN 1 AND 40", "BETWEEN 1 AND 41", /title length constraint/],
]) {
  test(label, () => {
    assert.ok(migration.includes(original));
    const directory = mkdtempSync(join(tmpdir(), "astra-sql-"));
    const candidate = join(directory, "migration.sql");
    const verifyMigration = (sql, status, diagnostic) => {
      writeFileSync(candidate, sql);
      const result = spawnSync(process.execPath, [verify, candidate], { encoding: "utf8", timeout: 10_000 });
      assert.ifError(result.error);
      assert.equal(result.status, status, result.stderr);
      if (diagnostic) assert.match(result.stderr, diagnostic);
    };

    try {
      verifyMigration(migration, 0);
      verifyMigration(migration.replace(original, injected), 1, error);
      verifyMigration(migration, 0);
    } finally {
      try {
        unlinkSync(candidate);
      } finally {
        rmdirSync(directory);
      }
    }
  });
}
