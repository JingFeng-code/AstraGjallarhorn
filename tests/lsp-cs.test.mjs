import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LspManager, resolveServer, normaliseLocations, toUri } from "../extensions/lsp.js";

const example = fileURLToPath(new URL("../examples/dotnet", import.meta.url));
const spec = await resolveServer("csharp", example);
await spec.cleanup?.();
const serverProcesses = () => Number(execFileSync("pwsh", ["-NoProfile", "-Command",
  "(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*Microsoft.CodeAnalysis.LanguageServer*' -or $_.CommandLine -like '*Microsoft.CodeAnalysis.Workspaces.MSBuild.BuildHost*' } | Measure-Object).Count"], { encoding: "utf8" }).trim());

test("Roslyn: workspace loads, CS0029 appears and clears, navigation works, no process is left", { skip: spec.error ?? false, timeout: 240000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "astra-lsp-cs-"));
  const manager = new LspManager();
  const baseline = serverProcesses();
  try {
    await cp(example, root, { recursive: true });
    execFileSync("dotnet", ["restore", "Notes.Tests.csproj", "--locked-mode"], { cwd: root, stdio: "pipe" });
    const store = path.join(root, "Storage", "NoteStore.cs");
    const original = await readFile(store, "utf8");
    const client = await manager.get("csharp", store, root);
    const errorsOf = (r) => (r.diagnostics ?? []).filter((d) => (d.severity ?? 1) <= 2);

    const before = await client.diagnose(store, "csharp", { timeout: 90000 });
    assert.ok(before.diagnostics, "server answered");
    assert.deepEqual(errorsOf(before), [], "baseline has no errors");

    await writeFile(store, original.replace("int id = notes.Count + 1;", 'int id = "oops";'));
    const bad = await client.diagnose(store, "csharp", { timeout: 90000 });
    assert.ok(errorsOf(bad).some((d) => d.code === "CS0029"), `CS0029 expected, got ${JSON.stringify(bad.diagnostics?.map((d) => d.code))}`);

    await writeFile(store, original);
    const good = await client.diagnose(store, "csharp", { timeout: 90000 });
    assert.equal(good.version, bad.version + 1);
    assert.deepEqual(errorsOf(good), [], "CS0029 cleared after the fix");

    const text = original.split("\n");
    const line = text.findIndex((l) => l.includes("public Note Load"));
    const column = text[line].indexOf("Load") + 1;
    const refs = normaliseLocations(await client.request("textDocument/references", { textDocument: { uri: toUri(store) }, position: { line, character: column }, context: { includeDeclaration: true } }, 60000));
    assert.ok(refs.length >= 2, `declaration plus a use in tests, got ${refs.length}`);
    assert.ok(refs.some((r) => path.basename(r.path) === "NoteTests.cs"));
    const callFile = path.join(root, "NoteTests.cs");
    const callText = (await readFile(callFile, "utf8")).split("\n");
    const callLine = callText.findIndex((l) => l.includes(".Load("));
    await client.sync(callFile, "csharp");
    const def = normaliseLocations(await client.request("textDocument/definition", { textDocument: { uri: toUri(callFile) }, position: { line: callLine, character: callText[callLine].indexOf(".Load(") + 2 } }, 60000));
    assert.equal(path.basename(def[0].path), "NoteStore.cs");
    assert.equal(def[0].line, line + 1);

    const pid = client.child.pid;
    await manager.stopAll();
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal(serverProcesses(), baseline, "Roslyn and its build host are gone");
    assert.throws(() => process.kill(pid, 0));
  } finally { await manager.stopAll(); await rm(root, { recursive: true, force: true }); }
});

test("Roslyn never restores packages on its own (no implicit download)", { skip: spec.error ?? false, timeout: 240000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "astra-lsp-cs-norestore-"));
  const manager = new LspManager();
  try {
    await cp(example, root, { recursive: true });
    const store = path.join(root, "Storage", "NoteStore.cs");
    const client = await manager.get("csharp", store, root);
    await client.diagnose(store, "csharp", { timeout: 60000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 3000));
    const { access } = await import("node:fs/promises");
    await assert.rejects(access(path.join(root, "obj", "project.assets.json")), "no restore output was produced");
  } finally { await manager.stopAll(); await rm(root, { recursive: true, force: true }); }
});
