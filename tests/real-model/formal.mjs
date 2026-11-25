// Formal Pi acceptance (not CI): runs the installed Pi with its real extension set and a real local model.
// node tests/real-model/formal.mjs <pi cli> [scenario]
// Uses --no-session and throwaway working directories; never touches Pi's auth, models or settings.
import assert from "node:assert/strict";
import { cp, mkdir, writeFile, readFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { startPi } from "../lib/pi-rpc.mjs";

const [cli, only] = process.argv.slice(2);
const model = process.env.FORMAL_MODEL ?? "mimo-v2.6-agent32k";
const repo = fileURLToPath(new URL("../..", import.meta.url));
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8" });
const toolText = (e) => (e.result?.content ?? []).map((c) => c.text).join("\n");
const calls = (pi) => pi.toolEnds().map((e) => `${e.toolName}${e.isError ? "(error)" : ""}`);
const results = [];

async function ask(pi, message, ms = 240000) {
  const timer = setTimeout(() => pi.send("abort").catch(() => {}), ms);
  try { await pi.prompt(message); } finally { clearTimeout(timer); }
}
const open = (cwdSetup, args = []) => startPi({ cli, real: { model }, formal: true, extensions: [], script: [], cwdSetup, args });
const initRepo = (work) => { git(work, "init", "-q"); git(work, "config", "user.email", "t@e.test"); git(work, "config", "user.name", "t"); };

const scenarios = {
  async inventory() {
    const pi = await open();
    try {
      const res = await pi.send("get_commands");
      const names = (res.data?.commands ?? []).map((c) => c.name);
      const need = ["guard", "checkpoint", "task", "handoff-auto", "lsp", "review-diff", "tool-profile", "retry-limit", "hashline", "mode"];
      const missing = need.filter((n) => !names.includes(n));
      results.push({ scenario: "inventory", commandsPresent: need.filter((n) => names.includes(n)), missing });
      assert.deepEqual(missing, []);
    } finally { await pi.close(); }
  },

  async "guard-and-checkpoint"() {
    const pi = await open(async (work) => {
      initRepo(work);
      await writeFile(path.join(work, "keep.txt"), "committed\n");
      git(work, "add", "-A"); git(work, "commit", "-qm", "init");
      await writeFile(path.join(work, "keep.txt"), "uncommitted work\n");
    }, ["--tools", "read,bash"]);
    try {
      await ask(pi, "Run exactly this shell command and report the result: git reset --hard");
      const blocked = pi.toolEnds().filter((e) => /Blocked by command guard/.test(toolText(e)));
      const kept = await readFile(path.join(pi.work, "keep.txt"), "utf8");
      const refs = git(pi.work, "for-each-ref", "refs/astra/checkpoints", "--format=%(refname)").trim().split("\n").filter(Boolean);
      results.push({ scenario: "guard-and-checkpoint", calls: calls(pi), blockedByGuard: blocked.length, fileSurvived: kept === "uncommitted work\n", checkpointRefs: refs.length });
      assert.ok(blocked.length >= 1);
      assert.equal(kept, "uncommitted work\n");
      assert.ok(refs.length >= 1);
    } finally { await pi.close(); }
  },

  async "lsp-ts"() {
    const pi = await open(async (work) => {
      await mkdir(path.join(work, "src"));
      await writeFile(path.join(work, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "es2022", module: "nodenext", moduleResolution: "nodenext", noEmit: true }, include: ["src"] }));
      await writeFile(path.join(work, "package.json"), '{"type":"module"}');
      await writeFile(path.join(work, "src", "lib.ts"), "export function greet(name: string): string {\n  return `hi ${name}`;\n}\n");
      await writeFile(path.join(work, "src", "main.ts"), 'import { greet } from "./lib.js";\n\nconst count: number = greet("a");\nconsole.log(count);\n');
    }, ["--tools", "read,edit,lsp_diagnostics,lsp_definition,lsp_references"]);
    try {
      await ask(pi, "The TypeScript project does not compile and you do not know where. Run lsp_diagnostics on src/main.ts and src/lib.ts first. Do not read files before you have the diagnostics. Fix the reported error with the edit tool (change the declared type, keep the call), then run lsp_diagnostics on that file again to confirm it is CLEAN.");
      const tsc = spawnSync(process.execPath, [path.join(homedir(), ".pi", "agent", "lsp", "node_modules", "typescript", "lib", "tsc.js"), "-p", "."], { cwd: pi.work, encoding: "utf8" });
      const diags = pi.toolEnds().filter((e) => e.toolName === "lsp_diagnostics");
      results.push({ scenario: "lsp-ts", calls: calls(pi), sawErrors: diags.some((e) => /^ERRORS/.test(toolText(e))), lastDiagnostics: diags.at(-1) ? toolText(diags.at(-1)).split("\n")[0] : null, independentTscExit: tsc.status });
      assert.equal(tsc.status, 0);
      assert.ok(diags.some((e) => /^ERRORS/.test(toolText(e))));
    } finally { await pi.close(); }
  },

  async "lsp-cs"() {
    const pi = await open(async (work) => {
      await cp(path.join(repo, "examples", "dotnet"), work, { recursive: true });
      execFileSync("dotnet", ["restore", "Notes.Tests.csproj", "--locked-mode"], { cwd: work, stdio: "pipe" });
      const f = path.join(work, "Storage", "NoteStore.cs");
      await writeFile(f, (await readFile(f, "utf8")).replace("int id = notes.Count + 1;", 'int id = "oops";'));
    }, ["--tools", "read,edit,lsp_diagnostics,lsp_definition,lsp_references"]);
    try {
      await ask(pi, "The C# project does not compile and you do not know where. Run the lsp_diagnostics tool on each of these files first: Domain/Note.cs, Storage/NoteStore.cs, NoteTests.cs. Do not read files before you have the diagnostics. Fix the reported error with the edit tool (an int id must come from notes.Count + 1; the read tool takes a parameter named file, and edit takes file, anchor_from, anchor_to and text), then run lsp_diagnostics on that file again to confirm it is CLEAN.", 300000);
      const build = spawnSync("dotnet", ["build", "Notes.Tests.csproj", "--no-restore", "-nologo", "-v", "q"], { cwd: pi.work, encoding: "utf8" });
      const diags = pi.toolEnds().filter((e) => e.toolName === "lsp_diagnostics");
      results.push({ scenario: "lsp-cs", firstErrors: pi.toolEnds().filter((e) => e.isError).slice(0, 3).map((e) => `${e.toolName}: ${toolText(e).slice(0, 200)}`), calls: calls(pi).slice(0, 12), sawErrors: diags.some((e) => /^ERRORS/.test(toolText(e))), lastDiagnostics: diags.at(-1) ? toolText(diags.at(-1)).split("\n")[0] : null, independentBuildExit: build.status });
      assert.equal(build.status, 0);
    } finally { await pi.close(); }
  },

  async "diff-review"() {
    const pi = await open(async (work) => {
      initRepo(work);
      await mkdir(path.join(work, "src"));
      await writeFile(path.join(work, "src", "price.ts"), "export const price = (n: number) => n * 2;\n");
      git(work, "add", "-A"); git(work, "commit", "-qm", "init");
      await writeFile(path.join(work, "src", "price.ts"), "export const price = (n: number) => n * 3;\n");
      git(work, "add", "src/price.ts");
      await writeFile(path.join(work, "src", "extra.ts"), "export const extra = 1;\n");
    });
    try {
      const snap = () => git(pi.work, "status", "--porcelain=v2") + git(pi.work, "diff", "HEAD", "--binary");
      const before = snap();
      await pi.prompt("/tool-profile review");
      await ask(pi, "Review the uncommitted changes. Call review_diff first, then report problems ordered by severity, including missing regression tests. Do not modify anything.");
      const text = (await pi.send("get_last_assistant_text")).data?.text ?? "";
      results.push({ scenario: "diff-review", calls: calls(pi), usedReviewDiff: pi.toolEnds().some((e) => e.toolName === "review_diff"), mentionsTestGap: /test/i.test(text), worktreeUnchanged: snap() === before });
      assert.ok(pi.toolEnds().some((e) => e.toolName === "review_diff"));
      assert.equal(snap(), before);
    } finally { await pi.close(); }
  },
};

for (const [name, run] of Object.entries(scenarios)) {
  if (only && only !== name) continue;
  const started = Date.now();
  try { await run(); results.at(-1).seconds = Math.round((Date.now() - started) / 1000); results.at(-1).pass = true; }
  catch (error) { results.push({ scenario: name, pass: false, error: String(error.message).slice(0, 400) }); }
}
console.log(JSON.stringify({ model, pi: "formal install", results }, null, 2));
process.exit(results.every((r) => r.pass) ? 0 : 1);
