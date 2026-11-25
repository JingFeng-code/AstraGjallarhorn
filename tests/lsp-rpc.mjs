import assert from "node:assert/strict";
import { cp, writeFile, mkdir, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startPi, piCli } from "./lib/pi-rpc.mjs";

const procs = (needle) => Number(execFileSync("pwsh", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${needle}*' -and $_.ProcessId -ne $PID } | Measure-Object).Count`], { encoding: "utf8" }).trim());
const text = (e) => (e.result?.content ?? []).map((c) => c.text).join("\n");

// ---------- TypeScript ----------
const tsls = process.env.ASTRA_TSLS;
if (tsls) {
  const ts = await startPi({
    cli: piCli(), extensions: ["lsp.js"], env: { ASTRA_TSLS: tsls },
    cwdSetup: async (work) => {
      await mkdir(path.join(work, "src"));
      await writeFile(path.join(work, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "es2022", module: "nodenext", moduleResolution: "nodenext", noEmit: true }, include: ["src"] }));
      await writeFile(path.join(work, "package.json"), '{"type":"module"}');
      await writeFile(path.join(work, "src", "lib.ts"), "export function greet(name: string): string {\n  return `hi ${name}`;\n}\n");
      await writeFile(path.join(work, "src", "main.ts"), 'import { greet } from "./lib.js";\nconst n: number = "oops";\nconsole.log(greet("a"), n);\n');
    },
    script: [
      { tools: [{ name: "lsp_diagnostics", args: { path: "src/main.ts" } }] },
      { tools: [{ name: "bash", args: { command: `node -e "const fs=require('fs');fs.writeFileSync('src/main.ts', fs.readFileSync('src/main.ts','utf8').replace('\\"oops\\"','42'))"` } }] },
      { tools: [{ name: "lsp_diagnostics", args: { path: "src/main.ts" } }] },
      { tools: [{ name: "lsp_definition", args: { path: "src/main.ts", line: 3, column: 15 } }] },
      { tools: [{ name: "lsp_references", args: { path: "src/lib.ts", line: 1, column: 18 } }] },
      { tools: [{ name: "lsp_diagnostics", args: { path: "../outside.ts" } }] },
      { tools: [{ name: "lsp_diagnostics", args: { path: "README.md" } }] },
      { text: "done" },
    ],
  });
  let before;
  try {
    before = procs("typescript-language-server");
    await ts.prompt("fix the type error using the language server");
    const ends = ts.toolEnds();
    assert.equal(ends.length, 7);
    assert.match(text(ends[0]), /ERRORS[\s\S]*2322/);
    assert.match(text(ends[2]), /CLEAN: src\/main\.ts/, text(ends[2]));
    assert.match(text(ends[3]), /src.lib\.ts:1:/);
    assert.ok(text(ends[4]).split("\n").length >= 3, text(ends[4]));
    assert.match(text(ends[5]), /outside the working directory/);
    assert.match(text(ends[6]), /No language server/);
    assert.equal(procs("typescript-language-server"), before + 1, "one server is running during the session");
  } finally { await ts.close(); }
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(procs("typescript-language-server"), before, "server stopped with Pi");
  console.log("PASS lsp(ts): Pi tool dispatch reports error, confirms CLEAN after the model's fix, navigation, path refusal, server cleanup");
} else console.log("SKIP lsp(ts): ASTRA_TSLS not set");

// ---------- C# ----------
const example = fileURLToPath(new URL("../examples/dotnet", import.meta.url));
const cs = await startPi({
  cli: piCli(), extensions: ["lsp.js"],
  cwdSetup: async (work) => {
    await cp(example, work, { recursive: true });
    execFileSync("dotnet", ["restore", "Notes.Tests.csproj", "--locked-mode"], { cwd: work, stdio: "pipe" });
    const f = path.join(work, "Storage", "NoteStore.cs");
    await writeFile(f, (await readFile(f, "utf8")).replace("int id = notes.Count + 1;", 'int id = "oops";'));
  },
  script: [
    { tools: [{ name: "lsp_diagnostics", args: { path: "Storage/NoteStore.cs" } }] },
    { tools: [{ name: "bash", args: { command: `node -e "const fs=require('fs');fs.writeFileSync('Storage/NoteStore.cs', fs.readFileSync('Storage/NoteStore.cs','utf8').replace('\\"oops\\"','notes.Count + 1'))"` } }] },
    { tools: [{ name: "lsp_diagnostics", args: { path: "Storage/NoteStore.cs" } }] },
    { tools: [{ name: "lsp_references", args: { path: "Storage/NoteStore.cs", line: 16, column: 17 } }] },
    { text: "done" },
  ],
});
let beforeCs;
try {
  beforeCs = procs("Microsoft.CodeAnalysis");
  await cs.prompt("fix the C# type error");
  const ends = cs.toolEnds();
  assert.equal(ends.length, 4);
  assert.match(text(ends[0]), /ERRORS[\s\S]*CS0029/, text(ends[0]));
  assert.match(text(ends[2]), /CLEAN: Storage\/NoteStore\.cs/, text(ends[2]));
  assert.match(text(ends[3]), /NoteTests\.cs/, text(ends[3]));
} finally { await cs.close(); }
await new Promise((r) => setTimeout(r, 3000));
assert.equal(procs("Microsoft.CodeAnalysis"), beforeCs, "Roslyn and build host stopped with Pi");
console.log("PASS lsp(cs): Pi tool dispatch reports CS0029, confirms clean after the fix, cross-file references, server cleanup");
