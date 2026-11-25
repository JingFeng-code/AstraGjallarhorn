import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { startPi, piCli } from "./lib/pi-rpc.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
const outsideName = `guard-outside-${process.pid}.txt`;

async function scenario(confirm) {
  const pi = await startPi({
    cli: piCli(),
    extensions: ["command-guard.js"],
    cwdSetup: async (work) => {
      git(work, "init", "-q");
      git(work, "config", "user.email", "t@example.test");
      git(work, "config", "user.name", "t");
      await writeFile(path.join(work, "keep.txt"), "committed\n");
      git(work, "add", "-A");
      git(work, "commit", "-qm", "init");
      await writeFile(path.join(work, "keep.txt"), "uncommitted work\n");
      await writeFile(path.join(work, "build.log"), "x");
    },
    script: [
      { tools: [{ name: "bash", args: { command: "git reset --hard" } }] },
      { tools: [{ name: "bash", args: { command: "node -v" } }] },
      { tools: [{ name: "bash", args: { command: `echo leaked > ../${outsideName}` } }] },
      { tools: [{ name: "write", args: { path: `../${outsideName}`, content: "leaked" } }] },
      { tools: [{ name: "bash", args: { command: "cat ~/.pi/agent/auth.json" } }] },
      { tools: [{ name: "bash", args: { command: "npm --version" } }] },
      { text: "done" },
    ],
  });
  pi.confirmAnswer = confirm;
  try {
    await pi.prompt("run the script");
    const ends = pi.toolEnds();
    const text = (e) => JSON.stringify(e.result ?? e);
    return { pi, ends, text, work: pi.work };
  } catch (error) {
    await pi.close();
    throw error;
  }
}

const denied = await scenario(false);
try {
  const { ends, text, work } = denied;
  assert.equal(ends.length, 6, "six tool calls reached execution");
  assert.match(text(ends[0]), /Blocked by command guard/, "git reset --hard asks and the human declines");
  assert.equal(await readFile(path.join(work, "keep.txt"), "utf8"), "uncommitted work\n", "uncommitted work survives");
  assert.ok(!ends[1].isError, "ordinary node -v is allowed");
  assert.match(text(ends[2]), /outside the authorized directories/);
  assert.match(text(ends[3]), /outside the authorized directories/);
  assert.match(text(ends[4]), /credential/);
  assert.ok(!ends[5].isError, "ordinary npm --version is allowed");
  await assert.rejects(access(path.join(work, "..", outsideName)), "no file leaked outside the work directory");
  console.log("PASS guard: destructive git declined, outside writes and credential reads denied, normal commands allowed");
} finally {
  await denied.pi.close();
}

const approved = await scenario(true);
try {
  const { ends, work } = approved;
  assert.ok(!ends[0].isError, "approved destructive command runs");
  assert.equal(await readFile(path.join(work, "keep.txt"), "utf8"), "committed\n");
  console.log("PASS guard: a human approval lets the asked command run, denials stay denied");
  assert.match(JSON.stringify(ends[2].result ?? ends[2]), /outside the authorized directories/);
} finally {
  await approved.pi.close();
}
