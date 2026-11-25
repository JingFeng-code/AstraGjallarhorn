// Real-model acceptance (not part of CI): node tests/real-model/run.mjs <pi cli> <scenario> [model]
// Scenarios exercise the v0.2 additions through a real Pi process and a real local Ollama model.
import assert from "node:assert/strict";
import { cp, mkdir, writeFile, readFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startPi } from "../lib/pi-rpc.mjs";

const [cli, scenario, model = "mimo-v2.6-agent32k:latest"] = process.argv.slice(2);
const repo = fileURLToPath(new URL("../..", import.meta.url));
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8" });
const tsls = process.env.ASTRA_TSLS;
const calls = (pi) => pi.toolEnds().map((e) => `${e.toolName}${e.isError ? "(error)" : ""}`);
const toolText = (e) => (e.result?.content ?? []).map((c) => c.text).join("\n");
const started = Date.now();
const report = (extra) => console.log(JSON.stringify({ scenario, model, seconds: Math.round((Date.now() - started) / 1000), ...extra }, null, 2));
const lspTools = "read,edit,lsp_diagnostics,lsp_definition,lsp_references";

async function runPrompt(pi, message, ms) {
  const timer = setTimeout(() => pi.send("abort").catch(() => {}), ms);
  try { await pi.prompt(message); } finally { clearTimeout(timer); }
}

const scenarios = {
  async "lsp-ts"() {
    const pi = await startPi({
      cli, real: { model }, extensions: ["lsp.js"], env: { ASTRA_TSLS: tsls }, args: ["--tools", lspTools], script: [],
      cwdSetup: async (work) => {
        await mkdir(path.join(work, "src"));
        await writeFile(path.join(work, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "es2022", module: "nodenext", moduleResolution: "nodenext", noEmit: true }, include: ["src"] }));
        await writeFile(path.join(work, "package.json"), '{"type":"module"}');
        await writeFile(path.join(work, "src", "lib.ts"), "export function greet(name: string): string {\n  return `hi ${name}`;\n}\n");
        await writeFile(path.join(work, "src", "main.ts"), 'import { greet } from "./lib.js";\n\nconst count: number = greet("a");\nconsole.log(count);\n');
      },
    });
    try {
      await runPrompt(pi, "src/main.ts has a TypeScript error. Use the lsp_diagnostics tool on src/main.ts to find it, fix it with the edit tool so the types are correct (change the declared type, keep the call), then run lsp_diagnostics again to confirm it is CLEAN. Only use read, edit and lsp tools.", 240000);
      const tsc = spawnSync(process.execPath, [path.join(path.dirname(tsls), "..", "..", "typescript", "lib", "tsc.js"), "-p", "."], { cwd: pi.work, encoding: "utf8" });
      const diags = pi.toolEnds().filter((e) => e.toolName === "lsp_diagnostics");
      report({ calls: calls(pi), sawErrors: diags.some((e) => /^ERRORS/.test(toolText(e))), firstDiagnostics: diags[0] ? toolText(diags[0]).split("\n").slice(0, 2).join(" | ") : null, lastDiagnostics: diags.at(-1) ? toolText(diags.at(-1)).split("\n")[0] : null, independentTscExit: tsc.status, mainTs: await readFile(path.join(pi.work, "src", "main.ts"), "utf8") });
      assert.equal(tsc.status, 0);
    } finally { await pi.close(); }
  },

  async "lsp-cs"() {
    const pi = await startPi({
      cli, real: { model }, extensions: ["lsp.js"], args: ["--tools", lspTools], script: [],
      cwdSetup: async (work) => {
        await cp(path.join(repo, "examples", "dotnet"), work, { recursive: true });
        execFileSync("dotnet", ["restore", "Notes.Tests.csproj", "--locked-mode"], { cwd: work, stdio: "pipe" });
        const f = path.join(work, "Storage", "NoteStore.cs");
        await writeFile(f, (await readFile(f, "utf8")).replace("int id = notes.Count + 1;", 'int id = "oops";'));
      },
    });
    try {
      await runPrompt(pi, "The C# project does not compile and you do not know where. Run the lsp_diagnostics tool on each of these files first: Domain/Note.cs, Storage/NoteStore.cs, NoteTests.cs. Do not read files before you have the diagnostics. Fix the reported error with the edit tool (an int id must come from notes.Count + 1), then run lsp_diagnostics on that file again to confirm it is CLEAN.", 300000);
      const build = spawnSync("dotnet", ["build", "Notes.Tests.csproj", "--no-restore", "-nologo", "-v", "q"], { cwd: pi.work, encoding: "utf8" });
      const diags = pi.toolEnds().filter((e) => e.toolName === "lsp_diagnostics");
      report({ calls: calls(pi), sawErrors: diags.some((e) => /^ERRORS/.test(toolText(e))), firstDiagnostics: diags[0] ? toolText(diags[0]).split("\n").slice(0, 2).join(" | ") : null, lastDiagnostics: diags.at(-1) ? toolText(diags.at(-1)).split("\n")[0] : null, independentBuildExit: build.status });
      assert.equal(build.status, 0);
    } finally { await pi.close(); }
  },

  async "diff-review"() {
    const pi = await startPi({
      cli, real: { model }, extensions: ["diff-review.js", "tool-profile.js"], script: [],
      cwdSetup: async (work) => {
        git(work, "init", "-q"); git(work, "config", "user.email", "t@e.test"); git(work, "config", "user.name", "t");
        await mkdir(path.join(work, "src")); await mkdir(path.join(work, "tests"));
        await writeFile(path.join(work, "AGENTS.md"), "# Architecture\n- src/domain must not import from src/infra.\n");
        await writeFile(path.join(work, "src", "price.ts"), "export const price = (n: number) => n * 2;\n");
        await writeFile(path.join(work, "tests", "price.test.ts"), "import { price } from '../src/price';\nconsole.assert(price(2) === 4);\n");
        git(work, "add", "-A"); git(work, "commit", "-qm", "init");
        await mkdir(path.join(work, "src", "domain"));
        await writeFile(path.join(work, "src", "price.ts"), "export const price = (n: number) => n * 3;\n");
        git(work, "add", "src/price.ts");
        await writeFile(path.join(work, "src", "domain", "order.ts"), "import { db } from '../infra/db';\nexport const total = () => db.sum();\n");
      },
    });
    try {
      const snapshot = () => git(pi.work, "status", "--porcelain=v2") + git(pi.work, "diff", "HEAD", "--binary");
      const before = snapshot();
      await pi.prompt("/tool-profile review");
      await runPrompt(pi, "Review the uncommitted changes in this repository. Call review_diff first, read AGENTS.md, and report problems ordered by severity, including missing regression tests and architecture violations. Do not modify anything.", 240000);
      const answer = await pi.send("get_last_assistant_text");
      const text = answer.data?.text ?? "";
      const reviewCalls = pi.toolEnds().filter((e) => e.toolName === "review_diff");
      report({ calls: calls(pi), usedReviewDiff: reviewCalls.length > 0, mentionsTestGap: /test/i.test(text), mentionsArchitecture: /infra|architect|domain/i.test(text), worktreeUnchanged: snapshot() === before, answer: text.slice(0, 900) });
      assert.equal(snapshot(), before);
      assert.ok(reviewCalls.length > 0);
    } finally { await pi.close(); }
  },

  async "guard-normal-loop"() {
    const pi = await startPi({
      cli, real: { model }, extensions: ["command-guard.js"], args: ["--tools", "read,edit,bash"], script: [],
      cwdSetup: async (work) => {
        await cp(path.join(repo, "examples", "sql"), work, { recursive: true });
        const f = path.join(work, "001-create-notes.sql");
        await writeFile(f, (await readFile(f, "utf8")).replace("BETWEEN 1 AND 40", "BETWEEN 1 AND 20"));
      },
    });
    try {
      await runPrompt(pi, "Run `node verify.mjs` in this directory. It fails. Find the cause in 001-create-notes.sql, fix only that value with the edit tool, then run `node verify.mjs` again until it exits 0.", 240000);
      const final = spawnSync(process.execPath, ["verify.mjs"], { cwd: pi.work, encoding: "utf8" });
      const blocked = pi.toolEnds().filter((e) => /Blocked by command guard/.test(toolText(e)));
      report({ calls: calls(pi), guardBlockedNormalCalls: blocked.length, independentVerifyExit: final.status });
      assert.equal(blocked.length, 0);
      assert.equal(final.status, 0);
    } finally { await pi.close(); }
  },
};

if (!scenarios[scenario]) { console.error(`scenarios: ${Object.keys(scenarios).join(", ")}`); process.exit(2); }
await scenarios[scenario]();
