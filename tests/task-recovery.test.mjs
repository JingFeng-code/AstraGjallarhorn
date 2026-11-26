import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Journal, buildResumePrompt, classifyTool, findOrphans, pidAlive, summarizeTools, selectResumeTask, claimResume } from "../extensions/task-recovery.js";

const task = (over = {}) => ({
  id: "t1", sessionId: "s", cwd: "/p", prompt: "migrate the notes table", startedAt: new Date().toISOString(), ownerPid: 999999991, status: "running",
  tools: [
    { id: "1", name: "bash", brief: '{"command":"echo one > a.txt"}', class: "mutating", state: "ended", isError: false },
    { id: "2", name: "read", brief: '{"path":"a.txt"}', class: "read", state: "ended", isError: false },
    { id: "3", name: "bash", brief: '{"command":"node deploy.js"}', class: "mutating", state: "started" },
    { id: "4", name: "grep", brief: '{"pattern":"x"}', class: "read", state: "started" },
  ], ...over,
});

test("classification separates read-only from state-changing calls", () => {
  assert.equal(classifyTool("read", {}), "read");
  assert.equal(classifyTool("bash", { command: "git status --porcelain" }), "read");
  assert.equal(classifyTool("bash", { command: "git push origin main" }), "mutating");
  assert.equal(classifyTool("bash", { command: "ls; rm -rf x" }), "mutating");
  assert.equal(classifyTool("bash", { command: "find . -name a -delete" }), "mutating");
  assert.equal(classifyTool("bash", { command: "git branch -D old" }), "mutating");
  assert.equal(classifyTool("bash", { command: "git branch newbranch" }), "mutating");
  assert.equal(classifyTool("bash", { command: "git remote add x url" }), "mutating");
  assert.equal(classifyTool("bash", { command: "git branch -a" }), "read");
  assert.equal(classifyTool("bash", { command: "git diff --stat" }), "read");
  assert.equal(classifyTool("write", {}), "mutating");
  assert.equal(classifyTool("mystery", {}), "unknown");
});

test("stale running tasks become interrupted; live owners and self are left alone", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "astra-journal-"));
  try {
    const j = new Journal(dir);
    await j.save(task({ id: "dead" }));
    await j.save(task({ id: "live", ownerPid: process.pid + 1 }));
    await j.save(task({ id: "mine", ownerPid: process.pid }));
    await j.save(task({ id: "done", status: "completed" }));
    const found = await j.recoverStale((pid) => pid === process.pid + 1, process.pid);
    assert.deepEqual(found.map((t) => t.id), ["dead"]);
    assert.equal((await j.load("dead")).status, "interrupted");
    assert.equal((await j.load("live")).status, "running");
    assert.equal((await j.load("mine")).status, "running");
    assert.equal((await j.load("done")).status, "completed");
    assert.equal(pidAlive(process.pid), true);
    assert.equal(pidAlive(999999991), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("resume lock allows one continuer and recovers from a dead lock owner", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "astra-journal-"));
  try {
    const j = new Journal(dir);
    const first = await j.lockForResume("t1");
    assert.equal(first.ok, true);
    const second = await j.lockForResume("t1");
    assert.equal(second.ok, false);
    assert.match(second.reason, /already continuing/);
    await first.release();
    await writeFile(path.join(dir, "t2.resume.lock"), "999999991");
    assert.equal((await j.lockForResume("t2")).ok, true, "stale lock from a dead pid is replaced");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("resume prompt forbids repeating completed work and blind reruns of unknown-outcome calls", () => {
  const t = task();
  const s = summarizeTools(t);
  assert.equal(s.done.length, 2);
  assert.equal(s.inflight.length, 2);
  assert.equal(s.unsafe.length, 1);
  const prompt = buildResumePrompt(t, { checkpoint: "20260101-000000-abcd" });
  assert.match(prompt, /migrate the notes table/);
  assert.match(prompt, /Do NOT repeat them/);
  assert.match(prompt, /node deploy\.js\}?"?\}?\s+\[may have changed state\]/);
  assert.match(prompt, /grep.*\[read-only, safe to repeat\]/);
  assert.match(prompt, /Never re-run it blindly/);
  assert.match(prompt, /\/checkpoint restore 20260101-000000-abcd/);
});

test("orphan finder only reports children created during the task", async () => {
  const start = Date.now() - 10_000;
  const rows = [{ pid: 11, name: "node.exe", created: start + 1000 }, { pid: 12, name: "old.exe", created: start - 60_000 }];
  const found = await findOrphans(4242, new Date(start).toISOString(), async (owner) => { assert.equal(owner, 4242); return rows; });
  if (process.platform === "win32") assert.deepEqual(found.map((r) => r.pid), [11]);
});

test("natural-language recovery selection is scoped and does not guess among candidates", () => {
  const a = task({id:"a",status:"interrupted"});
  const b = task({id:"b",status:"timeout"});
  const other = task({id:"other",cwd:"/other",status:"interrupted"});
  const claimed = task({id:"claimed",status:"aborted",resumedBy:"other"});
  assert.equal(selectResumeTask([a,other,claimed],"/p").task.id,"a");
  assert.deepEqual(selectResumeTask([a,b,other,claimed],"/p").candidates.map(t=>t.id),["a","b"]);
  assert.equal(selectResumeTask([a,b],"/p","b").task.id,"b");
  assert.equal(selectResumeTask([other,claimed],"/p","other").task,undefined);
  assert.equal(selectResumeTask([task()],"/p").task,undefined);
});
test("claim rechecks scope and persisted state under lock; duplicate continuation refused", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(),"astra-claim-"));
  try {
    const j = new Journal(dir);
    const a = task({id:"a",status:"interrupted"});
    await j.save(a);
    assert.equal((await claimResume(j,a,"/other")).ok,false);
    const first = await claimResume(j,a,"/p");
    assert.equal(first.ok,true);
    assert.equal((await claimResume(j,a,"/p")).ok,false);
    await first.release();
    assert.equal((await claimResume(j,a,"/p")).ok,false);
    assert.match((await j.load("a")).resumedBy,/pid/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test("a just-created resume lock with no owner yet is not removed", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(),"astra-lock-"));
  try {
    const j = new Journal(dir);
    await writeFile(path.join(dir,"a.resume.lock"),"");
    assert.equal((await j.lockForResume("a")).ok,false);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
