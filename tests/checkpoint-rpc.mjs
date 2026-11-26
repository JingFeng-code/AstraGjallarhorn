import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile as readRaw, writeFile, access } from "node:fs/promises";
const readFile = async (p, e) => (await readRaw(p, e)).split("\r\n").join("\n");
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
    { tools: [{ name: "checkpoint_preview", args: {} }] },
    (request) => {
      const result = request.messages.filter(m => m.role === "tool").at(-1);
      const id = JSON.stringify(result).match(/\d{8}-\d{6}-[a-f0-9]{4}/)?.[0];
      return { tools: [{ name: "checkpoint_preview", args: { checkpointId: id ?? "missing" } }] };
    },
    { text: "preview only" },
  ],
});
try {
  await pi.prompt("change things");
  const refs = git(pi.work, "for-each-ref", "refs/astra/checkpoints", "--format=%(refname)").trim().split("\n");
  assert.equal(refs.length, 2, `pre and post refs: ${refs}`);
  assert.ok(refs.some((r) => r.endsWith("/pre")) && refs.some((r) => r.endsWith("/post")));
  const id = refs[0].split("/")[3];
  assert.ok(pi.notices().some((n) => n.includes(`Checkpoint ${id} saved before the task`)));
  await pi.prompt("剛才的修改有問題，先幫我查看能不能還原");
  const previews = pi.toolEnds().filter(e => e.toolName === "checkpoint_preview");
  assert.equal(previews.length,2);
  assert.equal(previews[0].result.details.candidates[0].id,id);
  assert.equal(previews[1].result.details.previewOnly,true);
  assert.equal(previews[1].result.details.id,id);
  assert.equal(await readFile(path.join(pi.work, "a.txt"), "utf8"), "agent\n");
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
