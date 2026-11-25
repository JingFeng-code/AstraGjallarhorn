import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { startPi, piCli } from "./lib/pi-rpc.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
const pi = await startPi({
  cli: piCli(),
  extensions: ["checkpoint.js"],
  cwdSetup: async (work) => {
    git(work, "init", "-q");
    git(work, "config", "user.email", "t@example.test");
    git(work, "config", "user.name", "t");
    await writeFile(path.join(work, "a.txt"), "head\n");
    git(work, "add", "-A");
    git(work, "commit", "-qm", "init");
    await writeFile(path.join(work, "a.txt"), "user draft\n");
    await writeFile(path.join(work, "u.txt"), "untracked\n");
  },
  script: [
    { tools: [{ name: "bash", args: { command: "echo agent > a.txt && echo made > created.txt && rm u.txt" } }] },
    { text: "done" },
  ],
});
try {
  await pi.prompt("change things");
  const refs = git(pi.work, "for-each-ref", "refs/astra/checkpoints", "--format=%(refname)").trim().split("\n");
  assert.equal(refs.length, 2, `pre and post refs: ${refs}`);
  assert.ok(refs.some((r) => r.endsWith("/pre")) && refs.some((r) => r.endsWith("/post")));
  const id = refs[0].split("/")[3];
  assert.ok(pi.notices().some((n) => n.includes(`Checkpoint ${id} saved before the task`)));
  await pi.prompt("/checkpoint restore " + id);
  await new Promise((r) => setTimeout(r, 1500));
  assert.match(pi.notices().at(-1), /REVERT a\.txt[\s\S]*Preview only/);
  assert.equal(await readFile(path.join(pi.work, "a.txt"), "utf8"), "agent\n", "preview did not change files");
  await pi.prompt("/checkpoint restore " + id + " --apply");
  await new Promise((r) => setTimeout(r, 2500));
  assert.match(pi.notices().at(-1), /Reverted 3 file/);
  assert.equal(await readFile(path.join(pi.work, "a.txt"), "utf8"), "user draft\n");
  assert.equal(await readFile(path.join(pi.work, "u.txt"), "utf8"), "untracked\n");
  await assert.rejects(access(path.join(pi.work, "created.txt")));
  await pi.prompt("/checkpoint isolate agent-two");
  await new Promise((r) => setTimeout(r, 800));
  assert.match(pi.notices().at(-1), /Would create git worktree/);
  await pi.prompt("/checkpoint isolate agent-two --apply");
  await new Promise((r) => setTimeout(r, 2500));
  assert.match(pi.notices().at(-1), /Created worktree/);
  assert.match(git(pi.work, "worktree", "list"), /agent-two/);
  console.log("PASS checkpoint: automatic pre/post snapshot, preview, scoped restore through real Pi");
} finally { await pi.close(); }
