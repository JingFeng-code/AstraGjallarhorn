import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("LSP bridge contains no download or install code path", async () => {
  const source = await readFile(new URL("../extensions/lsp.js", import.meta.url), "utf8");
  const code = source.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /\bfetch\s*\(/);
  assert.doesNotMatch(code, /require\(["']https?["']\)|from "node:https?"/);
  assert.doesNotMatch(code, /spawn\(\s*["'`](npm|npx|nuget|pnpm|yarn|winget)/);
  assert.doesNotMatch(code, /execFile\(\s*["'`](npm|npx|nuget|dotnet\b.*(restore|tool))/);
});
