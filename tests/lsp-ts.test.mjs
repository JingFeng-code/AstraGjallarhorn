import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { LspManager, normaliseLocations, toUri } from "../extensions/lsp.js";

const tsls = process.env.ASTRA_TSLS;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test("TypeScript server: diagnostics appear, clear after the fix, navigation works, process is cleaned up", { skip: !tsls && "ASTRA_TSLS not set" }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "astra-lsp-ts-"));
  const manager = new LspManager();
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "es2022", module: "nodenext", moduleResolution: "nodenext", noEmit: true }, include: ["src"] }));
    await writeFile(path.join(root, "package.json"), '{"type":"module"}');
    const lib = path.join(root, "src", "lib.ts");
    const main = path.join(root, "src", "main.ts");
    await writeFile(lib, "export function greet(name: string): string {\n  return `hi ${name}`;\n}\n");
    await writeFile(main, 'import { greet } from "./lib.js";\nconst n: number = "oops";\nconsole.log(greet("a"), n);\n');
    const client = await manager.get("typescript", main, root);
    const pid = client.child.pid;
    assert.ok(alive(pid));

    const bad = await client.diagnose(main, "typescript");
    assert.ok(bad.diagnostics, "server answered");
    assert.ok(bad.diagnostics.some((d) => d.code === 2322), `TS2322 expected, got ${JSON.stringify(bad.diagnostics.map((d) => d.code))}`);
    const version = bad.version;

    await writeFile(main, 'import { greet } from "./lib.js";\nconst n: number = 42;\nconsole.log(greet("a"), n);\n'); // edited by "any tool"
    const good = await client.diagnose(main, "typescript");
    assert.equal(good.version, version + 1, "document re-synced from disk");
    assert.deepEqual(good.diagnostics, [], "positive CLEAN report, not inconclusive");

    const def = normaliseLocations(await client.request("textDocument/definition", { textDocument: { uri: toUri(main) }, position: { line: 2, character: 14 } }));
    assert.equal(path.basename(def[0].path), "lib.ts");
    assert.equal(def[0].line, 1);
    await client.sync(lib, "typescript");
    const refs = normaliseLocations(await client.request("textDocument/references", { textDocument: { uri: toUri(lib) }, position: { line: 0, character: 20 }, context: { includeDeclaration: true } }));
    assert.ok(refs.length >= 3, `declaration + import + call, got ${refs.length}`);

    await manager.stopAll();
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(alive(pid), false, "server process terminated");
  } finally { await manager.stopAll(); await rm(root, { recursive: true, force: true }); }
});
