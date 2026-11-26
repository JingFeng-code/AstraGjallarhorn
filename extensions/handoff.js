// AstraGjallarhorn automatic Herdr handoff.
// Off by default. When the user enables it with an explicit receiver, the third qualifying
// failure reported by retry-limit is packaged into a summary file and sent once, through the
// existing `hc` CLI, to that receiver. Nothing in Herdr, hc or the receiving agent is configured.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, open, stat, unlink, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CONFIG_ENTRY = "astragjallarhorn-handoff-config";
const RESULT_ENTRY = "astragjallarhorn-handoff-result";
const MARKER = /\[astra-handoff depth=(\d+)/;
const HOURLY_CAP = 3;
const WIN = process.platform === "win32";
const norm = (p) => (WIN ? path.resolve(String(p)).toLowerCase() : path.resolve(String(p)));

export function agentDir() {
  return process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
}

function hcRunner() {
  const script = process.env.ASTRA_HC_NODE; // test seam: run a Node script instead of hc.exe
  return (args, timeout = 20000) => new Promise((resolve) => {
    const [file, argv] = script ? [process.execPath, [script, ...args]] : ["hc", args];
    execFile(file, argv, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, code: error?.code ?? 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

async function describeTarget(runHc, target) {
  const res = await runHc(["get", target, "--json"]);
  if (!res.ok) return { error: `receiver ${target} not found (${res.stderr.trim().slice(0, 120) || `exit ${res.code}`})` };
  let info;
  try { info = JSON.parse(res.stdout); } catch { return { error: "hc returned unreadable data for the receiver" }; }
  return {
    info,
    address: info.address,
    live: info.state === "live",
    state: info.status?.state ?? "unknown",
    agent: info.status?.app ?? info.labels?.["astra.tool"] ?? "",
    cwd: info.cwd,
    turn: info.turn ?? 0,
    session: info.labels?.["astra.session"],
  };
}

// Pure validation, used both when enabling and when sending.
export function validateReceiver(desc, { cwd, selfSession, expectedAgent }) {
  if (desc.error) return desc.error;
  if (!desc.live) return `receiver ${desc.address} is not live`;
  if (desc.session && selfSession && desc.session === selfSession) return "receiver is this very Pi session";
  if (!desc.cwd || norm(desc.cwd) !== norm(cwd)) return `receiver working directory differs (${desc.cwd}) from ${cwd}`;
  if (expectedAgent && desc.agent !== expectedAgent) return `receiver agent changed from ${expectedAgent} to ${desc.agent || "unknown"}; refusing because cost cannot be re-confirmed`;
  if (desc.state !== "idle") return `receiver is ${desc.state}, not idle`;
  return undefined;
}

async function readLedger(file) {
  try { const parsed = JSON.parse(await readFile(file, "utf8")); return Array.isArray(parsed.entries) ? parsed : { entries: [] }; } catch { return { entries: [] }; }
}

const pidAlive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; } };

// Serialises every read-modify-write of the ledger across Pi processes (exclusive lock file,
// stale locks from dead processes are taken over) and writes atomically.
export async function withLedger(dir, fn) {
  const lock = path.join(dir, "ledger.lock");
  const file = path.join(dir, "ledger.json");
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      const handle = await open(lock, "wx");
      await handle.writeFile(String(process.pid));
      await handle.close();
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const info = await stat(lock).catch(() => undefined);
      const owner = Number(await readFile(lock, "utf8").catch(() => "0"));
      if (info && (Date.now() - info.mtimeMs > 15_000 || (owner && !pidAlive(owner)))) { await unlink(lock).catch(() => {}); continue; }
      if (Date.now() > deadline) throw new Error("handoff ledger is locked by another process");
      await new Promise((r) => setTimeout(r, 40));
    }
  }
  try {
    const ledger = await readLedger(file);
    const out = await fn(ledger);
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(ledger, null, 2));
    await rename(tmp, file);
    return out;
  } finally { await unlink(lock).catch(() => {}); }
}

// Masks secrets before anything is written to a summary file or typed into another agent.
const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[REDACTED PRIVATE KEY]"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [REDACTED]"],
  [/\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, "[REDACTED KEY]"],
  [/\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/g, "[REDACTED GITHUB TOKEN]"],
  [/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED AWS KEY]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "[REDACTED SLACK TOKEN]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "[REDACTED JWT]"],
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, "$1[REDACTED]@"],
  [/((?:api[_-]?key|secret|token|password|passwd|pwd|authorization|credential)s?["']?\s*[:=]\s*)(["']?)[^\s"',;&]{3,}\2/gi, "$1[REDACTED]"],
  [/(--?(?:password|passwd|token|api-?key|secret)[= ])[^\s]+/gi, "$1[REDACTED]"],
];
export function redact(text) {
  let out = String(text ?? "");
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

export function buildSummary({ failure, cwd, sessionId, sessionFile, task, git, checkpoint, depth }) {
  return [
    `# Astra handoff [astra-handoff depth=${depth}]`,
    "",
    `Created: ${new Date().toISOString()}`,
    `Reason: ${failure.reason} on tool \`${failure.tool}\` (policy ${failure.policy}).`,
    `Working directory: ${cwd}`,
    `Originating Pi session: ${sessionId ?? "unknown"}${sessionFile ? ` (${sessionFile})` : ""}`,
    checkpoint ? `Checkpoint before the task: ${checkpoint} (restore with /checkpoint restore ${checkpoint} in Pi)` : "",
    "",
    "## Task",
    redact(task) || "(not captured)",
    "",
    "## Last failing call",
    "```json",
    redact(JSON.stringify({ tool: failure.tool, args: failure.args, error: failure.error }, null, 2)),
    "```",
    "",
    "## Working tree",
    redact(git) || "(not a git repository)",
    "",
    "## Instructions for the receiver",
    "- The sending Pi stopped after three identical or consecutive failures. Do not repeat the same call blindly.",
    "- Inspect the failing call's error first, change approach, then verify with the project's own verification command.",
    "- Reply with what you changed and the verification exit code. Do not hand this task back automatically.",
  ].filter((line) => line !== "").join("\n");
}

export async function performHandoff({ config, failure, ctxInfo, runHc = hcRunner(), dir = path.join(agentDir(), "handoffs"), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), confirmMs = 20000 }) {
  const result = (status, detail, extra = {}) => ({ status, detail, ...extra });
  if (!config?.enabled || !config.target) return result("skipped", "automatic handoff is off");
  if (ctxInfo.inheritedDepth >= 1) return result("blocked", "this session is itself the result of a handoff; refusing to hand off again (loop prevention)");
  await mkdir(dir, { recursive: true });
  const key = createHash("sha1").update(JSON.stringify([ctxInfo.sessionId, ctxInfo.taskKey, failure.reason, failure.tool, failure.args])).digest("hex").slice(0, 16);
  const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${key}.md`);
  // Claim the failure atomically before anything is sent, so concurrent Pi processes cannot both pass.
  // Recording "sending" first also means a crash or timeout leaves an unknown outcome that is never re-sent.
  const claim = await withLedger(dir, (ledger) => {
    const prior = ledger.entries.find((e) => e.key === key && e.status !== "rejected");
    if (prior) return { blocked: `this failure was already handed off (${prior.status}); not sending again` };
    const now = Date.now();
    if (ledger.entries.filter((e) => e.at > now - 3600_000 && e.status !== "rejected").length >= HOURLY_CAP) return { blocked: `handoff cap of ${HOURLY_CAP} per hour reached` };
    if (ledger.entries.some((e) => e.target === config.target && e.status === "sending" && e.at > now - 120_000)) return { blocked: "another handoff to this receiver is being sent right now" };
    ledger.entries.push({ key, at: now, target: config.target, file, status: "sending" });
    return { ok: true };
  });
  if (claim.blocked) return result("blocked", claim.blocked);
  const setStatus = (status) => withLedger(dir, (ledger) => { const e = ledger.entries.find((x) => x.key === key); if (e) e.status = status; });

  const summary = buildSummary({ failure, cwd: ctxInfo.cwd, sessionId: ctxInfo.sessionId, sessionFile: ctxInfo.sessionFile, task: ctxInfo.task, git: ctxInfo.git, checkpoint: ctxInfo.checkpoint, depth: 1 });
  await writeFile(file, summary + "\n");

  const before = await describeTarget(runHc, config.target);
  const problem = validateReceiver(before, { cwd: ctxInfo.cwd, selfSession: ctxInfo.sessionId, expectedAgent: config.agent });
  if (problem) { await setStatus("rejected"); return result("failed", `${problem}. Summary kept at ${file}`, { file }); }

  const line = `Astra handoff [astra-handoff depth=1]: read ${file} and continue the task described there. Reply when started.`;
  const sent = await runHc(["send", config.target, line, "--if", "idle", "--json"], 30000);
  if (!sent.ok) { await setStatus("send-failed"); return result("failed", `hc send failed (${sent.stderr.trim().slice(0, 160) || `exit ${sent.code}`}). Summary kept at ${file}; not retried`, { file }); }

  const deadline = Date.now() + confirmMs;
  while (Date.now() < deadline) {
    await sleep(Math.min(1000, Math.max(50, confirmMs / 20)));
    const now = await describeTarget(runHc, config.target);
    if (!now.error && (now.turn > before.turn || now.state === "working")) {
      await setStatus("received");
      return result("received", `receiver ${config.target} (${before.agent}) picked up the handoff`, { file });
    }
  }
  await setStatus("unconfirmed");
  return result("unconfirmed", `sent to ${config.target} but no acceptance was observed; not resending. Summary: ${file}`, { file });
}

export default function (pi) {
  let config = { enabled: false };
  let inheritedDepth = 0;
  let task = "";
  let taskKey = "";
  let lastCheckpoint;
  const load = (ctx) => {
    const entry = ctx.sessionManager.getEntries().findLast((item) => item.type === "custom" && item.customType === CONFIG_ENTRY);
    config = entry?.data ?? { enabled: false };
  };
  pi.on("session_start", (_e, ctx) => load(ctx));
  pi.on("input", (event) => {
    if (event.source === "extension") return;
    const m = String(event.text ?? "").match(MARKER);
    if (m) inheritedDepth = Math.max(inheritedDepth, Number(m[1]));
    if (!String(event.text ?? "").startsWith("/")) { task = String(event.text ?? "").slice(0, 2000); taskKey = `${Date.now()}`; }
  });
  pi.events.on("astra:checkpoint", (data) => { lastCheckpoint = data?.id; });

  async function gitSummary(cwd) {
    try {
      const status = await pi.exec("git", ["status", "--porcelain"], { cwd, timeout: 10000 });
      const stat = await pi.exec("git", ["diff", "--stat", "HEAD"], { cwd, timeout: 10000 });
      return `\`git status --porcelain\`:\n${status.stdout.trim() || "(clean)"}\n\n\`git diff --stat HEAD\`:\n${stat.stdout.trim() || "(none)"}`;
    } catch { return undefined; }
  }

  pi.registerCommand("handoff-auto", {
    description: "Automatic Herdr handoff (off by default). Usage: on <terminal> --no-extra-cost | off | status | check",
    async handler(args, ctx) {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const option = parts[0] ?? "status";
      const notify = (m, l = "info") => ctx.ui.notify(m, l);
      const runHc = hcRunner();
      if (option === "off") { config = { enabled: false }; pi.appendEntry(CONFIG_ENTRY, config); notify("Automatic handoff off."); return; }
      if (option === "status") { notify(config.enabled ? `Automatic handoff on -> ${config.target} (${config.agent}).` : "Automatic handoff off (manual handoff only)."); return; }
      if (option === "check") {
        if (!config.enabled) { notify("Automatic handoff is off.", "warning"); return; }
        const problem = validateReceiver(await describeTarget(runHc, config.target), { cwd: ctx.cwd, selfSession: ctx.sessionManager.getSessionId(), expectedAgent: config.agent });
        notify(problem ? `Receiver not ready: ${problem}` : `Receiver ${config.target} is ready.`, problem ? "warning" : "info");
        return;
      }
      if (option === "on") {
        const target = parts[1];
        if (!target || !parts.includes("--no-extra-cost")) { notify("Usage: /handoff-auto on <terminal> --no-extra-cost  (the flag confirms the receiver adds no cost)", "error"); return; }
        const desc = await describeTarget(runHc, target);
        const problem = validateReceiver(desc, { cwd: ctx.cwd, selfSession: ctx.sessionManager.getSessionId() });
        if (problem) { notify(`Not enabled: ${problem}`, "error"); return; }
        config = { enabled: true, target, agent: desc.agent };
        pi.appendEntry(CONFIG_ENTRY, config);
        notify(`Automatic handoff on -> ${target} (${desc.agent}). It fires once, after the retry limit stops a task. Retry limit must be on.`);
        return;
      }
      notify("Usage: /handoff-auto on <terminal> --no-extra-cost | off | status | check", "error");
    },
  });

  pi.events.on("astra:retry-stopped", async (failure) => {
    if (!config.enabled) return;
    const ctx = pi.__lastCtx;
    if (!ctx) return;
    const outcome = await performHandoff({
      config, failure,
      ctxInfo: {
        cwd: ctx.cwd, sessionId: ctx.sessionManager.getSessionId(), sessionFile: ctx.sessionManager.getSessionFile?.(),
        task, taskKey, inheritedDepth, checkpoint: lastCheckpoint, git: await gitSummary(ctx.cwd),
      },
    });
    pi.appendEntry(RESULT_ENTRY, outcome);
    ctx.ui.notify(`Handoff ${outcome.status}: ${outcome.detail}`, outcome.status === "received" ? "info" : "warning");
  });
  pi.on("agent_start", (_e, ctx) => { pi.__lastCtx = ctx; });
  pi.on("tool_execution_start", (_e, ctx) => { pi.__lastCtx = ctx; });
}
