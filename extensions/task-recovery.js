// AstraGjallarhorn task recovery.
// Keeps a durable journal of each agent task. After Pi dies (crash, closed terminal, reboot)
// the next Pi process finds the unfinished task, never assumes an OS process can be resumed,
// and offers a safe continuation that does not re-run completed work or blindly repeat an
// operation whose outcome is unknown.
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile, open, unlink, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";

const WIN = process.platform === "win32";
const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
const READ_ONLY_BASH = /^\s*(git\s+(status|diff|log|show|rev-parse|ls-files|branch(\s+-[av]+)?|remote(\s+-v)?|cat-file|blame|describe)\b|ls|dir|cat|type|head|tail|wc|grep|rg|find(?!.*-(delete|exec))|pwd|echo|node\s+(-v|--version)|npm\s+(--version|-v|ls|list)|dotnet\s+(--version|--info)|Get-Content|Get-ChildItem|Select-String)\b[^;&|><`$]*$/i;

export const journalDir = () => path.join(process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent"), "tasks");

export function classifyTool(name, args) {
  if (READ_ONLY_TOOLS.has(name)) return "read";
  if (name === "bash") return READ_ONLY_BASH.test(String(args?.command ?? "")) ? "read" : "mutating";
  if (name === "write" || name === "edit" || name === "multiedit") return "mutating";
  return "unknown";
}

export function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}

const brief = (args) => {
  const text = JSON.stringify(args ?? {});
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
};

async function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${randomBytes(2).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, file);
}

export class Journal {
  constructor(dir = journalDir()) { this.dir = dir; }
  file(id) { return path.join(this.dir, `${id}.json`); }
  async init() { await mkdir(this.dir, { recursive: true }); }
  async save(task) { await this.init(); await writeAtomic(this.file(task.id), task); }
  async load(id) { try { return JSON.parse(await readFile(this.file(id), "utf8")); } catch { return undefined; } }
  async all() {
    await this.init();
    const tasks = [];
    for (const name of await readdir(this.dir)) {
      if (!name.endsWith(".json")) continue;
      try { tasks.push(JSON.parse(await readFile(path.join(this.dir, name), "utf8"))); } catch { /* skip damaged */ }
    }
    return tasks.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }
  // Marks tasks whose owning process is gone. Returns the tasks newly recognised as interrupted.
  async recoverStale(isAlive = pidAlive, self = process.pid) {
    const found = [];
    for (const task of await this.all()) {
      if (task.status !== "running" || task.ownerPid === self) continue;
      if (isAlive(task.ownerPid)) continue; // another live Pi owns it: leave alone
      task.status = "interrupted";
      task.interruptedAt = new Date().toISOString();
      await this.save(task);
      found.push(task);
    }
    return found;
  }
  // Exclusive lock so two Pi processes cannot continue the same task.
  async lockForResume(id) {
    const lock = path.join(this.dir, `${id}.resume.lock`);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const handle = await open(lock, "wx");
        await handle.writeFile(String(process.pid));
        await handle.close();
        return { ok: true, release: () => unlink(lock).catch(() => {}) };
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        const owner = Number(await readFile(lock, "utf8").catch(() => "0"));
        if (pidAlive(owner)) return { ok: false, reason: `another Pi process (pid ${owner}) is already continuing this task` };
        await unlink(lock).catch(() => {}); // stale lock from a dead process
      }
    }
    return { ok: false, reason: "could not take the resume lock" };
  }
}

export function summarizeTools(task) {
  const done = task.tools.filter((t) => t.state === "ended");
  const failed = done.filter((t) => t.isError);
  const inflight = task.tools.filter((t) => t.state === "started");
  return { done, failed, inflight, unsafe: inflight.filter((t) => t.class !== "read") };
}

export function buildResumePrompt(task, { checkpoint } = {}) {
  const { done, failed, inflight, unsafe } = summarizeTools(task);
  const lines = [
    `[astra-resume ${task.id}] A previous Pi process stopped before finishing this task. Continue it safely.`,
    "",
    "Original request:",
    task.prompt,
    "",
    `Completed tool calls (${done.length}; ${failed.length} failed). Do NOT repeat them:`,
    ...done.slice(-25).map((t) => `- ${t.name} ${t.brief}${t.isError ? "  [FAILED]" : ""}`),
  ];
  if (inflight.length) {
    lines.push("", "Calls that were running when Pi stopped (OUTCOME UNKNOWN):");
    for (const t of inflight) lines.push(`- ${t.name} ${t.brief}  [${t.class === "read" ? "read-only, safe to repeat" : "may have changed state"}]`);
  }
  lines.push(
    "",
    "Rules:",
    "1. First inspect the real state (git status, git diff, file contents, test output). Conclude what is actually done from evidence.",
    unsafe.length
      ? "2. For every call marked 'may have changed state', check whether its effect already happened before doing anything similar. Never re-run it blindly, and never repeat an operation with external side effects (push, deploy, install, send, delete) without evidence it did not already happen."
      : "2. Nothing unsafe was in flight, but still verify the state before continuing.",
    "3. Continue only with what is still missing, then run the project's verification command.",
    checkpoint ? `4. A checkpoint from before the task exists: /checkpoint restore ${checkpoint} (preview first).` : "",
  );
  return lines.filter((l) => l !== "").join("\n");
}

// Child processes whose parent was the dead Pi. Report-only unless explicitly killed.
export async function findOrphans(ownerPid, sinceIso, run = defaultPs) {
  if (!WIN || !ownerPid) return [];
  const since = Date.parse(sinceIso) || 0;
  const rows = await run(ownerPid);
  return rows.filter((r) => r.created >= since - 2000 && r.pid !== process.pid);
}

function defaultPs(ownerPid) {
  const script = `Get-CimInstance Win32_Process -Filter "ParentProcessId=${Number(ownerPid)}" | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; name = $_.Name; created = ([datetimeoffset]$_.CreationDate).ToUnixTimeMilliseconds(); cmd = $_.CommandLine } } | ConvertTo-Json -Compress`;
  return new Promise((resolve) => {
    execFile("pwsh", ["-NoProfile", "-Command", script], { timeout: 15000, windowsHide: true }, (error, stdout) => {
      if (error || !stdout.trim()) return resolve([]);
      try { const parsed = JSON.parse(stdout); resolve(Array.isArray(parsed) ? parsed : [parsed]); } catch { resolve([]); }
    });
  });
}

export default function (pi) {
  const journal = new Journal();
  let current; // task being recorded in this process
  let timer;
  let timeoutMin = Number(process.env.ASTRA_TASK_TIMEOUT_MIN) || 0;
  let lastCheckpoint;
  let pendingPrompt;
  let lock;

  const stop = () => { if (timer) clearTimeout(timer); timer = undefined; };
  pi.events.on("astra:checkpoint", (data) => { lastCheckpoint = data?.id; });

  pi.on("session_start", async (_e, ctx) => {
    try {
      const stale = await journal.recoverStale();
      const mine = stale.filter((t) => t.cwd === ctx.cwd);
      if (mine.length) {
        const t = mine.at(-1);
        const { inflight, done } = summarizeTools(t);
        ctx.ui.notify(`Unfinished task ${t.id} found (Pi pid ${t.ownerPid} is gone): ${done.length} calls completed, ${inflight.length} outcome-unknown. Use /task resume ${t.id} to continue safely or /task discard ${t.id}.`, "warning");
      }
    } catch { /* recovery must never block startup */ }
  });

  pi.on("input", (event) => {
    if (event.source === "extension" && String(event.text).startsWith("[astra-resume")) return;
    if (!String(event.text ?? "").startsWith("/")) pendingPrompt = String(event.text ?? "");
  });

  pi.on("agent_start", async (_e, ctx) => {
    const id = `${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${randomBytes(2).toString("hex")}`;
    current = { id, sessionId: ctx.sessionManager.getSessionId(), cwd: ctx.cwd, prompt: pendingPrompt ?? "(unknown)", startedAt: new Date().toISOString(), ownerPid: process.pid, status: "running", tools: [], checkpoint: lastCheckpoint };
    await journal.save(current).catch(() => {});
    stop();
    if (timeoutMin > 0) {
      timer = setTimeout(async () => {
        if (!current) return;
        current.status = "timeout";
        await journal.save(current).catch(() => {});
        ctx.ui.notify(`Task ${current.id} exceeded ${timeoutMin} minutes and was cancelled.`, "warning");
        ctx.abort();
      }, timeoutMin * 60_000);
    }
  });

  pi.on("tool_execution_start", async (event) => {
    if (!current) return;
    current.tools.push({ id: event.toolCallId, name: event.toolName, brief: brief(event.args), class: classifyTool(event.toolName, event.args), state: "started", startedAt: new Date().toISOString() });
    await journal.save(current).catch(() => {});
  });

  pi.on("tool_execution_end", async (event) => {
    if (!current) return;
    const t = current.tools.find((x) => x.id === event.toolCallId);
    if (t) { t.state = "ended"; t.isError = Boolean(event.isError); t.endedAt = new Date().toISOString(); }
    await journal.save(current).catch(() => {});
  });

  pi.on("agent_end", async (event) => {
    stop();
    if (!current) return;
    const last = event?.messages?.findLast?.((m) => m.role === "assistant");
    if (current.status === "running") current.status = last?.stopReason === "aborted" ? "aborted" : last?.stopReason === "error" ? "failed" : "completed";
    current.endedAt = new Date().toISOString();
    await journal.save(current).catch(() => {});
    if (lock) { await lock.release(); lock = undefined; }
    current = undefined;
  });

  pi.on("session_shutdown", async () => {
    stop();
    if (current && current.status === "running") { current.status = "interrupted"; current.interruptedAt = new Date().toISOString(); await journal.save(current).catch(() => {}); }
    if (lock) await lock.release();
  });

  pi.registerCommand("task", {
    description: "Task recovery. Usage: status|list|resume [id] [--again]|discard [id]|timeout <min>|orphans [kill]",
    async handler(args, ctx) {
      const [option = "status", ...rest] = args.trim().split(/\s+/).filter(Boolean);
      const notify = (m, l = "info") => ctx.ui.notify(m, l);
      const all = (await journal.all()).filter((t) => t.cwd === ctx.cwd);
      const pick = (id) => (id && !id.startsWith("--") ? all.find((t) => t.id === id) : all.findLast((t) => t.status === "interrupted" || t.status === "timeout"));
      if (option === "timeout") {
        timeoutMin = Number(rest[0]) || 0;
        notify(timeoutMin ? `Tasks are cancelled after ${timeoutMin} minute(s).` : "Task timeout off.");
      } else if (option === "status" || option === "list") {
        const items = option === "status" ? all.slice(-3) : all.slice(-15);
        notify(items.length ? items.map((t) => `${t.id} ${t.status}${t.resumedBy ? ` (continued by ${t.resumedBy})` : ""} ${t.tools.length} calls  ${t.prompt.slice(0, 60)}`).join("\n") : "No recorded tasks for this directory.");
      } else if (option === "discard") {
        const t = pick(rest[0]);
        if (!t) { notify("No unfinished task to discard.", "error"); return; }
        t.status = "discarded"; await journal.save(t); notify(`Task ${t.id} discarded.`);
      } else if (option === "resume") {
        const t = pick(rest[0]);
        if (!t) { notify("No interrupted task to resume.", "error"); return; }
        if (!["interrupted", "timeout", "aborted"].includes(t.status)) { notify(`Task ${t.id} is ${t.status}; nothing to resume.`, "error"); return; }
        if (t.resumedBy && !rest.includes("--again")) { notify(`Task ${t.id} was already continued (${t.resumedBy}). Use --again only after checking the results.`, "error"); return; }
        const taken = await journal.lockForResume(t.id);
        if (!taken.ok) { notify(`Not resumed: ${taken.reason}`, "error"); return; }
        lock = taken;
        t.resumedBy = `pid ${process.pid} at ${new Date().toISOString()}`;
        await journal.save(t);
        pi.sendUserMessage(buildResumePrompt(t, { checkpoint: t.checkpoint }));
      } else if (option === "orphans") {
        const dead = all.filter((t) => ["interrupted", "timeout"].includes(t.status));
        const found = [];
        for (const t of dead) found.push(...(await findOrphans(t.ownerPid, t.startedAt)).map((o) => ({ ...o, task: t.id })));
        if (!found.length) { notify("No orphaned child processes."); return; }
        if (rest[0] === "kill" && await ctx.ui.confirm("Orphaned processes", found.map((o) => `${o.pid} ${o.name}`).join("\n"))) {
          for (const o of found) { try { process.kill(o.pid); } catch { /* already gone */ } }
          notify(`Stopped ${found.length} orphaned process(es).`);
        } else notify(found.map((o) => `${o.pid} ${o.name} (task ${o.task})`).join("\n") + "\nUse /task orphans kill to stop them.");
      } else notify("Usage: /task status|list|resume [id]|discard [id]|timeout <min>|orphans [kill]", "error");
    },
  });
}
