import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { startPi, piCli } from "./lib/pi-rpc.mjs";

const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8" });
const pi = await startPi({
  cli: piCli(), extensions: ["diff-review.js", "tool-profile.js"],
  cwdSetup: async (work) => {
    git(work, "init", "-q"); git(work, "config", "user.email", "t@e.test"); git(work, "config", "user.name", "t");
    await writeFile(path.join(work, "a.ts"), "export const a = 1;\n");
    git(work, "add", "-A"); git(work, "commit", "-qm", "init");
    await writeFile(path.join(work, "a.ts"), "export const a = 2;\n");
    git(work, "add", "a.ts");
    await writeFile(path.join(work, "a.ts"), "export const a = 3;\n");
    await writeFile(path.join(work, "new.ts"), "export const n = 1;\n");
  },
  script: [{ tools: [{ name: "review_diff", args: { scope: "all" } }] }, { text: "Review: a.ts changed without a regression test." }],
});
try {
  const state = () => pi.send("get_state");
  await pi.prompt("/tool-profile review");
  await pi.prompt("review my changes");
  const tools = pi.requests[0].tools.map((t) => t.function.name).sort();
  assert.deepEqual(tools, ["read", "review_diff"], "review profile exposes only read-only tools plus review_diff");
  const result = pi.toolEnds()[0];
  const text = JSON.stringify(result.result);
  assert.ok(!result.isError);
  assert.match(text, /\+export const a = 2;/);
  assert.match(text, /\+export const a = 3;/);
  assert.match(text, /new\.ts/);
  assert.match(text, /REGRESSION-TEST GAP/);
  assert.match(text, /fingerprint unchanged/);
  assert.equal(await readFile(path.join(pi.work, "a.ts"), "utf8"), "export const a = 3;\n");
  assert.equal(git(pi.work, "status", "--porcelain").trim().split("\n").length, 2);
  console.log("PASS diff review: model fetches staged+unstaged diff itself through a read-only tool; tree fingerprint unchanged");
} finally { await pi.close(); }
