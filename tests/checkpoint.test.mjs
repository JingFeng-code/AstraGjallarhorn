import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, access, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { applyRestore, createCheckpoint, listCheckpoints, planRestore, renderPlan, repoRootOf } from "../extensions/checkpoint.js";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
const exists = (p) => access(p).then(() => true, () => false);

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "astra-ckpt-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@example.test");
  git(root, "config", "user.name", "t");
  await writeFile(path.join(root, ".gitignore"), "ignored/\n");
  await writeFile(path.join(root, "a.txt"), "head\n");
  await writeFile(path.join(root, "other.txt"), "other head\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  return root;
}

test("checkpoint snapshots tracked and untracked state without touching index, HEAD or files", async () => {
  const root = await fixture();
  try {
    await writeFile(path.join(root, "a.txt"), "user work in progress\n");
    await writeFile(path.join(root, "u.txt"), "untracked user file\n");
    await mkdir(path.join(root, "ignored"));
    await writeFile(path.join(root, "ignored", "x.bin"), "cache");
    git(root, "add", "other.txt"); // nothing staged yet except nothing; stage an unrelated edit below
    await writeFile(path.join(root, "other.txt"), "other staged\n");
    git(root, "add", "other.txt");
    await writeFile(path.join(root, "other.txt"), "other staged then unstaged edit\n");
    const before = { status: git(root, "status", "--porcelain=v2"), head: git(root, "rev-parse", "HEAD"), cached: git(root, "diff", "--cached"), stash: git(root, "stash", "list") };

    const cp = await createCheckpoint(root, { phase: "pre", label: "t" });
    const after = { status: git(root, "status", "--porcelain=v2"), head: git(root, "rev-parse", "HEAD"), cached: git(root, "diff", "--cached"), stash: git(root, "stash", "list") };
    assert.deepEqual(after, before, "index, HEAD, stash and statuses are untouched");
    assert.equal(await readFile(path.join(root, "a.txt"), "utf8"), "user work in progress\n");
    // Snapshot content
    assert.equal(git(root, "show", `${cp.commit}:a.txt`), "user work in progress\n");
    assert.equal(git(root, "show", `${cp.commit}:u.txt`), "untracked user file\n");
    assert.equal(git(root, "show", `${cp.commit}:other.txt`), "other staged then unstaged edit\n");
    assert.throws(() => git(root, "show", `${cp.commit}:ignored/x.bin`), "ignored files are not captured");
    assert.equal((await listCheckpoints(root)).length, 1);
    assert.equal(await repoRootOf(root), path.resolve(root));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("restore reverts only the task's changes and protects other edits", async () => {
  const root = await fixture();
  try {
    await writeFile(path.join(root, "a.txt"), "user work in progress\n");
    await writeFile(path.join(root, "u.txt"), "untracked user file\n");
    const pre = await createCheckpoint(root, { phase: "pre", label: "task" });
    // --- the task ---
    await writeFile(path.join(root, "a.txt"), "agent edit\n");
    await writeFile(path.join(root, "new.txt"), "agent created\n");
    await writeFile(path.join(root, "created2.txt"), "agent created 2\n");
    await rm(path.join(root, "u.txt"));
    await createCheckpoint(root, { id: pre.id, phase: "post", label: "task end" });
    // --- somebody else after the task ---
    await writeFile(path.join(root, "other.txt"), "another agent edit\n");
    await writeFile(path.join(root, "new.txt"), "another agent also edited the created file\n");

    const plan = await planRestore(root, pre.id);
    const byPath = Object.fromEntries(plan.actions.map((a) => [a.path, a]));
    assert.deepEqual(Object.keys(byPath).sort(), ["a.txt", "created2.txt", "new.txt", "u.txt"]);
    assert.equal(byPath["a.txt"].kind, "restore-content");
    assert.equal(byPath["u.txt"].kind, "recreate-deleted");
    assert.equal(byPath["new.txt"].external, true);
    assert.equal(byPath["a.txt"].external, false);
    assert.deepEqual(plan.outside.map((c) => c.path), ["other.txt"]);
    assert.match(renderPlan(plan), /SKIP \(modified since the task\) new\.txt/);
    // preview changes nothing
    assert.equal(await readFile(path.join(root, "a.txt"), "utf8"), "agent edit\n");

    const result = await applyRestore(root, plan);
    assert.deepEqual(result.skipped, ["new.txt"]);
    assert.equal(await readFile(path.join(root, "a.txt"), "utf8"), "user work in progress\n", "restored to the pre-task state, not HEAD");
    assert.equal(await readFile(path.join(root, "u.txt"), "utf8"), "untracked user file\n", "deleted untracked file is back");
    assert.equal(await exists(path.join(root, "created2.txt")), false);
    assert.equal(await readFile(path.join(root, "new.txt"), "utf8"), "another agent also edited the created file\n");
    assert.equal(await readFile(path.join(root, "other.txt"), "utf8"), "another agent edit\n", "other agent's change untouched");
    assert.ok((await listCheckpoints(root)).some((c) => c.id === `${pre.id}-before-restore`), "safety checkpoint exists");

    // --force overrides the skipped path, and the safety checkpoint still holds the other agent's text
    const forced = await applyRestore(root, await planRestore(root, pre.id), { force: true });
    assert.ok(forced.done.includes("new.txt"));
    assert.equal(await exists(path.join(root, "new.txt")), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("restore without a post snapshot uses the current tree", async () => {
  const root = await fixture();
  try {
    const pre = await createCheckpoint(root, { phase: "pre" });
    await writeFile(path.join(root, "a.txt"), "edited mid-task\n");
    const plan = await planRestore(root, pre.id);
    assert.equal(plan.actions.length, 1);
    await applyRestore(root, plan);
    assert.equal(await readFile(path.join(root, "a.txt"), "utf8"), "head\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});
