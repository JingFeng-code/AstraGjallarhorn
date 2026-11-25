// AstraGjallarhorn automatic checkpoints.
// Snapshots the working tree (tracked + untracked, honouring .gitignore) into hidden refs
// under refs/astra/checkpoints using a private temporary index. The user's index, branches,
// stash and working files are never touched by a snapshot. Restore is path-scoped to what
// the task itself changed and refuses to overwrite anything modified by someone else.
import { execFile } from "node:child_process";
import { mkdir, writeFile, rm, stat, unlink, readdir, readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

const POLICY_ENTRY = "astragjallarhorn-checkpoint-policy";
const TASK_ENTRY = "astragjallarhorn-checkpoint-task";
const REF_ROOT = "refs/astra/checkpoints";
const KEEP = 30;
const IDENTITY = {
  GIT_AUTHOR_NAME: "Astra Checkpoint", GIT_AUTHOR_EMAIL: "checkpoint@astra.invalid",
  GIT_COMMITTER_NAME: "Astra Checkpoint", GIT_COMMITTER_EMAIL: "checkpoint@astra.invalid",
};

const SNAPSHOT_TIMEOUT_MS = Number(process.env.ASTRA_CHECKPOINT_TIMEOUT_MS) || 30000;

function git(cwd, args, { env = {}, input, binary = false, timeout = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile("git", args, {
      cwd, env: { ...process.env, ...env }, maxBuffer: 256 * 1024 * 1024, encoding: binary ? "buffer" : "utf8", windowsHide: true, timeout,
    }, (error, stdout, stderr) => {
      if (error) { error.stderr = String(stderr); reject(error); } else resolve(stdout);
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

export async function repoRootOf(cwd) {
  try { return path.resolve((await git(cwd, ["rev-parse", "--show-toplevel"])).trim()); } catch { return undefined; }
}

// Writes a tree for the full working state without touching the real index.
export async function snapshotTree(root) {
  const gitDir = path.resolve(root, (await git(root, ["rev-parse", "--git-dir"])).trim());
  const index = path.join(gitDir, `astra-ckpt-index-${process.pid}-${randomBytes(3).toString("hex")}`);
  const env = { GIT_INDEX_FILE: index };
  try {
    let hasHead = true;
    try { await git(root, ["rev-parse", "--verify", "-q", "HEAD"]); } catch { hasHead = false; }
    if (hasHead) await git(root, ["read-tree", "HEAD"], { env, timeout: SNAPSHOT_TIMEOUT_MS });
    await git(root, ["add", "-A", "--", "."], { env, timeout: SNAPSHOT_TIMEOUT_MS });
    // A nested repository would be stored as a gitlink, which cannot be restored. Report it.
    return (await git(root, ["write-tree"], { env })).trim();
  } finally {
    await rm(index, { force: true });
  }
}

async function commitTree(root, tree, message) {
  let parent = [];
  try { parent = ["-p", (await git(root, ["rev-parse", "--verify", "-q", "HEAD"])).trim()]; } catch { /* unborn branch */ }
  return (await git(root, ["commit-tree", tree, ...parent, "-m", message], { env: IDENTITY })).trim();
}

function newId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${randomBytes(2).toString("hex")}`;
}

export async function createCheckpoint(root, { label = "", phase = "pre", id = newId(), meta = {} } = {}) {
  const tree = await snapshotTree(root);
  const message = `astra checkpoint ${id} ${phase}\n\n${JSON.stringify({ id, phase, label, ...meta })}\n`;
  const commit = await commitTree(root, tree, message);
  await git(root, ["update-ref", `${REF_ROOT}/${id}/${phase}`, commit]);
  return { id, phase, tree, commit };
}

export async function listCheckpoints(root) {
  let out = "";
  try { out = await git(root, ["for-each-ref", "--format=%(refname)%09%(objectname)%09%(committerdate:iso-strict)", REF_ROOT]); } catch { return []; }
  const byId = new Map();
  for (const line of out.split("\n").filter(Boolean)) {
    const [ref, commit, date] = line.split("\t");
    const [, id, phase] = ref.slice(REF_ROOT.length).split("/");
    if (!byId.has(id)) byId.set(id, { id, date });
    byId.get(id)[phase] = commit;
  }
  const result = [];
  for (const entry of byId.values()) {
    let label = "";
    try {
      const msg = await git(root, ["log", "-1", "--format=%B", entry.pre ?? entry.post ?? entry.safety]);
      label = JSON.parse(msg.split("\n").find((l) => l.startsWith("{")) ?? "{}").label ?? "";
    } catch { /* ignore */ }
    result.push({ ...entry, label });
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

async function nameStatus(root, a, b) {
  const out = await git(root, ["diff", "--name-status", "-z", "--no-renames", a, b]);
  const parts = out.split("\0").filter(Boolean);
  const items = [];
  for (let i = 0; i + 1 < parts.length; i += 2) items.push({ status: parts[i][0], path: parts[i + 1] });
  return items;
}

async function blobAt(root, rev, file) {
  try { return (await git(root, ["rev-parse", `${rev}:${file}`])).trim(); } catch { return undefined; }
}

async function worktreeBlob(root, file) {
  try { await stat(path.join(root, file)); } catch { return undefined; }
  try { return (await git(root, ["hash-object", "--", file])).trim(); } catch { return undefined; }
}

// Plan restoring the changes a task made, between its pre and post snapshots.
export async function planRestore(root, id) {
  const refs = await listCheckpoints(root);
  const cp = refs.find((c) => c.id === id);
  if (!cp) throw new Error(`Unknown checkpoint ${id}`);
  if (!cp.pre) throw new Error(`Checkpoint ${id} has no pre snapshot`);
  const pre = cp.pre;
  // Without a post snapshot (task still running or interrupted) the task's own changes are
  // whatever differs from pre right now.
  let post = cp.post;
  let postTree;
  if (!post) postTree = await snapshotTree(root);
  const target = post ?? postTree;
  const changes = await nameStatus(root, pre, target);
  const actions = [];
  for (const change of changes) {
    const taskBlob = await blobAt(root, target, change.path); // state task left behind (undefined if deleted)
    const preBlob = await blobAt(root, pre, change.path); // state before the task
    const current = await worktreeBlob(root, change.path);
    const external = current !== taskBlob; // differs from where the task left it
    let kind;
    if (preBlob && taskBlob) kind = "restore-content";
    else if (!preBlob && taskBlob) kind = "delete-created";
    else kind = "recreate-deleted";
    actions.push({ path: change.path, kind, preBlob, external, currentExists: current !== undefined });
  }
  // Everything that differs between the post snapshot and now but was not part of the task.
  const nowTree = await snapshotTree(root);
  const outside = (await nameStatus(root, target, nowTree)).filter((c) => !changes.some((x) => x.path === c.path));
  return { id, pre, post, actions, outside };
}

export function renderPlan(plan) {
  const lines = [`Checkpoint ${plan.id}: ${plan.actions.length} task change(s) can be reverted.`];
  for (const a of plan.actions) {
    const verb = { "restore-content": "restore previous content", "delete-created": "delete file created by task", "recreate-deleted": "recreate file deleted by task" }[a.kind];
    lines.push(`  ${a.external ? "SKIP (modified since the task) " : "REVERT "}${a.path} -> ${verb}`);
  }
  if (plan.outside.length) lines.push(`Not part of the task, left untouched: ${plan.outside.map((c) => c.path).join(", ")}`);
  const skipped = plan.actions.filter((a) => a.external).length;
  if (skipped) lines.push(`${skipped} file(s) were changed after the task and will be skipped unless --force is given.`);
  return lines.join("\n");
}

export async function applyRestore(root, plan, { force = false } = {}) {
  const safety = await createCheckpoint(root, { id: `${plan.id}-before-restore`, phase: "safety", label: "automatic backup taken before restore" });
  const done = [];
  const skipped = [];
  for (const a of plan.actions) {
    if (a.external && !force) { skipped.push(a.path); continue; }
    const abs = path.join(root, a.path);
    if (a.kind === "delete-created") {
      await unlink(abs).catch(() => {});
    } else {
      const bytes = await git(root, ["cat-file", "--filters", `${plan.pre}:${a.path}`], { binary: true });
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, bytes);
    }
    done.push(a.path);
  }
  return { safety: safety.id, done, skipped };
}

// Other live Pi processes with a running task in the same work tree. Uses a marker per process
// inside the git directory, so it needs no coordination service and cleans up after crashes.
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; } };
async function activeDir(root) {
  const gitDir = path.resolve(root, (await git(root, ["rev-parse", "--git-dir"])).trim());
  return path.join(gitDir, "astra-active");
}
export async function markActive(root, info = {}) {
  const dir = await activeDir(root);
  await mkdir(dir, { recursive: true });
  const others = [];
  for (const name of await readdir(dir).catch(() => [])) {
    const pid = Number(name.replace(/.json$/, ""));
    if (!pid || pid === process.pid) continue;
    if (!alive(pid)) { await unlink(path.join(dir, name)).catch(() => {}); continue; }
    others.push({ pid, ...JSON.parse(await readFile(path.join(dir, name), "utf8").catch(() => "{}")) });
  }
  await writeFile(path.join(dir, `${process.pid}.json`), JSON.stringify({ ...info, startedAt: new Date().toISOString() }));
  return others;
}
export async function clearActive(root) {
  await unlink(path.join(await activeDir(root), `${process.pid}.json`)).catch(() => {});
}

async function prune(root) {
  const all = await listCheckpoints(root);
  const auto = all.filter((c) => !c.id.endsWith("-before-restore"));
  for (const c of auto.slice(0, Math.max(0, auto.length - KEEP))) {
    for (const phase of ["pre", "post", "safety"]) await git(root, ["update-ref", "-d", `${REF_ROOT}/${c.id}/${phase}`]).catch(() => {});
  }
}

export default function (pi) {
  let enabled = true;
  let current; // { id, root, preTree }
  let lastPostTree = new Map(); // root -> tree
  const readPolicy = (ctx) => {
    const entry = ctx.sessionManager.getEntries().findLast((item) => item.type === "custom" && item.customType === POLICY_ENTRY);
    enabled = entry?.data?.enabled ?? process.env.ASTRA_CHECKPOINT !== "off";
    const task = ctx.sessionManager.getEntries().findLast((item) => item.type === "custom" && item.customType === TASK_ENTRY);
    if (task?.data?.root && task.data.postTree) lastPostTree.set(task.data.root, task.data.postTree);
  };

  pi.on("session_start", (_e, ctx) => readPolicy(ctx));

  pi.on("agent_start", async (_event, ctx) => {
    current = undefined;
    if (!enabled) return;
    const root = await repoRootOf(ctx.cwd);
    if (!root) return;
    try {
      const cp = await createCheckpoint(root, { phase: "pre", label: "task start", meta: { session: ctx.sessionManager.getSessionId?.() } });
      let notice = `Checkpoint ${cp.id} saved before the task (restore: /checkpoint restore ${cp.id}).`;
      const last = lastPostTree.get(root);
      if (last && last !== cp.tree) {
        const changed = await nameStatus(root, last, cp.tree);
        if (changed.length) notice += ` ${changed.length} file(s) changed outside this session since the last task: ${changed.slice(0, 5).map((c) => c.path).join(", ")}${changed.length > 5 ? ", …" : ""}.`;
      }
      current = { id: cp.id, root };
      const others = await markActive(root, { checkpoint: cp.id, cwd: ctx.cwd }).catch(() => []);
      if (others.length) notice += ` WARNING: another Pi process (pid ${others.map((o) => o.pid).join(", ")}) is running a task in this same work tree. Edits will mix and restore cannot tell them apart; give each agent its own git worktree (/checkpoint isolate <name>).`;
      pi.events.emit("astra:checkpoint", { id: cp.id, root });
      pi.appendEntry(TASK_ENTRY, { id: cp.id, root, preTree: cp.tree, phase: "pre" });
      ctx.ui.notify(notice, "info");
      prune(root).catch(() => {});
    } catch (error) {
      ctx.ui.notify(`Checkpoint failed, task continues without one: ${String(error.stderr || error.message).slice(0, 200)}`, "warning");
    }
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (!current) return;
    const { id, root } = current;
    current = undefined;
    await clearActive(root);
    try {
      const cp = await createCheckpoint(root, { id, phase: "post", label: "task end" });
      lastPostTree.set(root, cp.tree);
      pi.appendEntry(TASK_ENTRY, { id, root, postTree: cp.tree, phase: "post" });
    } catch { /* checkpoint is best effort */ }
  });

  pi.registerCommand("checkpoint", {
    description: "Checkpoints. Usage: status|on|off|now [label]|list|diff <id>|restore <id> [--apply] [--force]|isolate <name> [--apply]",
    async handler(args, ctx) {
      const [option = "status", ...rest] = args.trim().split(/\s+/).filter(Boolean);
      const notify = (m, l = "info") => ctx.ui.notify(m, l);
      const root = await repoRootOf(ctx.cwd);
      if (option === "on" || option === "off") { enabled = option === "on"; pi.appendEntry(POLICY_ENTRY, { enabled }); notify(`Automatic checkpoints ${option}.`); return; }
      if (option === "status") { notify(`Automatic checkpoints ${enabled ? "on" : "off"}. Repository: ${root ?? "none (not a git work tree)"}.`); return; }
      if (!root) { notify("Not inside a git work tree.", "error"); return; }
      try {
        if (option === "now") {
          const cp = await createCheckpoint(root, { id: newId(), phase: "pre", label: rest.join(" ") || "manual" });
          notify(`Checkpoint ${cp.id} saved.`);
        } else if (option === "list") {
          const all = await listCheckpoints(root);
          notify(all.length ? all.map((c) => `${c.id}  ${c.pre ? "pre" : ""}${c.post ? "+post" : ""}${c.safety ? " safety" : ""}  ${c.label}`).join("\n") : "No checkpoints.");
        } else if (option === "diff") {
          const plan = await planRestore(root, rest[0]);
          notify(renderPlan(plan));
        } else if (option === "isolate") {
          const name = (rest[0] ?? "").replace(/[^A-Za-z0-9._-]/g, "");
          if (!name) { notify("Usage: /checkpoint isolate <name> [--apply]", "error"); return; }
          const dir = path.join(path.dirname(root), `${path.basename(root)}.worktrees`, name);
          const branch = `agent/${name}`;
          if (!rest.includes("--apply")) { notify(`Would create git worktree ${dir} on new branch ${branch} from HEAD. Start the other agent there. Add --apply to create it.`); return; }
          await git(root, ["worktree", "add", dir, "-b", branch, "HEAD"]);
          notify(`Created worktree ${dir} (branch ${branch}). Run the other agent in that directory; merge or delete it when done.`);
        } else if (option === "restore") {
          const id = rest.find((r) => !r.startsWith("--"));
          const plan = await planRestore(root, id);
          if (!rest.includes("--apply")) { notify(`${renderPlan(plan)}\nPreview only. Add --apply to revert.`); return; }
          const result = await applyRestore(root, plan, { force: rest.includes("--force") });
          notify(`Reverted ${result.done.length} file(s); skipped ${result.skipped.length}. Safety checkpoint: ${result.safety}.`);
        } else notify("Usage: /checkpoint status|on|off|now|list|diff <id>|restore <id> [--apply] [--force]", "error");
      } catch (error) {
        notify(`Checkpoint error: ${String(error.stderr || error.message).slice(0, 300)}`, "error");
      }
    },
  });
}
