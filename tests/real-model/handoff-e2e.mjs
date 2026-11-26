// Real Herdr handoff acceptance (not CI): formal Pi + real hc + a dedicated OpenCode receiver on a local Ollama model.
// node tests/real-model/handoff-e2e.mjs <pi cli>
// Only dedicated synthetic terminals are used. Nobody's working session is contacted.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { startPi } from "../lib/pi-rpc.mjs";

const cli = process.argv[2];
const root = "E:\\Astra\\.astra-runs\\handoff-e2e";
const results = [];
const hc = (...a) => spawnSync("hc", a, { encoding: "utf8" });
const hcJson = (...a) => { const r = hc(...a, "--json"); try { return JSON.parse(r.stdout); } catch { return undefined; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8" });
const toolText = (e) => (e.result?.content ?? []).map((c) => c.text).join("\n");
const handoffDir = path.join(os.homedir(), ".pi", "agent", "handoffs");

async function project(name) {
  const dir = path.join(root, name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json", model: "ollama/mimo-v2.6-agent32k:latest", small_model: "ollama/mimo-v2.6-agent32k:latest" }));
  await writeFile(path.join(dir, "notes.txt"), "alpha\nbeta\n");
  await writeFile(path.join(dir, "verify.mjs"), [
    'import { readFileSync } from "node:fs";',
    'const lines = readFileSync(new URL("./notes.txt", import.meta.url), "utf8").split(/\\r?\\n/).filter(Boolean);',
    'if (lines.length !== 3) { console.error(`FAIL: notes.txt must contain exactly 3 lines, found ${lines.length}`); process.exit(1); }',
    'console.log("PASS: notes.txt has 3 lines");', ""].join("\n"));
  git(dir, "init", "-q"); git(dir, "config", "user.email", "t@e.test"); git(dir, "config", "user.name", "t");
  git(dir, "add", "-A"); git(dir, "commit", "-qm", "init");
  return dir;
}
const launchReceiver = (name, dir) => {
  let r; try { r = JSON.parse(hc("run", "--json", "--bg", "--name", name, "--cwd", dir, "--no-parent", "--outlive-parent", "opencode", "--standalone", "--auto").stdout); } catch { /* reported below */ }
  assert.equal(r?.agent, "opencode", `receiver started: ${JSON.stringify(r)}`);
  return r.address;
};
async function waitState(name, state, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const g = hcJson("get", name); if (g?.status?.state === state) return g; await sleep(1500); }
  throw new Error(`receiver ${name} never became ${state}`);
}
const piOpen = (dir) => startPi({ cli, real: { model: "mimo-v2.6-agent32k" }, formal: true, extensions: [], script: [], workDir: dir, args: ["--tools", "bash"] });
const PROMPT = "Call the bash tool with exactly the command `node verify.mjs`. Whatever the result is, call the bash tool again with the identical command, until you have made 5 calls. Do not run any other command, do not read or modify any file (another agent will repair it), and do not stop early.";
const failures = (pi) => pi.toolEnds().filter((e) => e.toolName === "bash" && e.isError);
const dump = (pi) => ({ notices: pi.notices(), tools: pi.toolEnds().map((e) => `${e.toolName}${e.isError ? "(error)" : ""}: ${JSON.stringify(e.args ?? e.result ?? "").slice(0, 120)}`) });
const waitNotice = async (pi) => { try { await pi.waitFor(() => pi.notices().some((n) => n.startsWith("Handoff ")), 90000, "handoff notice"); } catch (error) { console.error(JSON.stringify(dump(pi), null, 1)); throw error; } };
// Parallel tool batches may already be running when the limit trips; what matters is that nothing NEW starts afterwards.
const noCallsAfterStop = (pi) => {
  const stop = pi.events.findIndex((e) => e.type === "extension_ui_request" && e.method === "notify" && String(e.message).startsWith("Retry limit stopped"));
  return stop >= 0 && !pi.events.slice(stop + 1).some((e) => e.type === "tool_execution_start");
};
const cleanup = (...names) => { for (const n of names) { hc("kill", n); hc("rm", n); } };

// ---------- 1. real handoff ----------
{
  const dir = await project("proj-ok");
  const addr = launchReceiver("gjh-recv-ok", dir);
  await waitState("gjh-recv-ok", "idle");
  const before = hcJson("get", "gjh-recv-ok");
  const pi = await piOpen(dir);
  try {
    await pi.prompt(`/handoff-auto on ${addr} --no-extra-cost`);
    await sleep(2500);
    assert.ok(pi.notices().some((n) => n.startsWith("Automatic handoff on")), `enabled: ${pi.notices().join(" | ")}`);
    await pi.prompt("/retry-limit on");
    const timer = setTimeout(() => pi.send("abort").catch(() => {}), 240000);
    await pi.prompt(PROMPT);
    clearTimeout(timer);
    await waitNotice(pi);
    const stopped = pi.toolEnds().filter((e) => e.toolName === "bash");
    const notice = pi.notices().find((n) => n.startsWith("Handoff "));
    const after = hcJson("get", "gjh-recv-ok");
    // OpenCode must work the task and finish.
    await sleep(3000);
    let verify;
    for (let i = 0; i < 120; i++) {
      verify = spawnSync(process.execPath, ["verify.mjs"], { cwd: dir, encoding: "utf8" });
      if (verify.status === 0) break;
      await sleep(3000);
    }
    const idle = await waitState("gjh-recv-ok", "idle", 120000).catch(() => hcJson("get", "gjh-recv-ok"));
    const ledger = JSON.parse(await readFile(path.join(handoffDir, "ledger.json"), "utf8"));
    const mine = ledger.entries.filter((e) => e.target === addr);
    const screen = hc("read", "gjh-recv-ok").stdout;
    const files = (await readdir(handoffDir)).filter((f) => f.endsWith(".md")).sort();
    const summary = await readFile(path.join(handoffDir, files.at(-1)), "utf8");
    const notes = await readFile(path.join(dir, "notes.txt"), "utf8");
    results.push({
      scenario: "real-handoff",
      piBashCalls: stopped.length, noCallsAfterStop: noCallsAfterStop(pi), piFailedCalls: failures(pi).length, handoffNotice: notice,
      receiverBefore: { status: before.status.state, turn: before.turn }, receiverAfter: { status: after.status.state, turn: after.turn },
      summaryHasTaskAndError: /node verify\.mjs/.test(summary) && /3 identical failures|consecutive/.test(summary),
      openCodeReadSummary: /handoffs/.test(screen) || /astra-handoff/.test(screen),
      receiverFinalStatus: idle?.status?.state, receiverFinalTurn: idle?.turn,
      independentVerifyExit: verify.status, notesTxt: notes,
      ledgerEntriesForReceiver: mine.map((e) => e.status),
      handoffMessagesOnReceiverScreen: (screen.match(/astra-handoff depth=1/g) ?? []).length,
    });
    if (verify.status !== 0) console.error("receiver screen:", screen.split("\n").filter((l) => l.trim()).slice(-40).join("\n"), "\nnotes.txt=", JSON.stringify(notes));
    assert.ok(failures(pi).length >= 3, "three failures reached");
    assert.ok(noCallsAfterStop(pi), "no tool call was started after Retry Limit stopped Pi");
    assert.match(notice, /^Handoff received/);
    assert.equal(verify.status, 0, "OpenCode completed the synthetic task");
    assert.equal(mine.length, 1);
  } finally { await pi.close(); cleanup("gjh-recv-ok"); }
}

// ---------- 2. busy receiver ----------
{
  const dir = await project("proj-busy");
  const addr = launchReceiver("gjh-recv-busy", dir);
  await waitState("gjh-recv-busy", "idle");
  const pi = await piOpen(dir);
  try {
    await pi.prompt(`/handoff-auto on ${addr} --no-extra-cost`);
    await sleep(2500);
    assert.ok(pi.notices().some((n) => n.startsWith("Automatic handoff on")));
    // keep the receiver busy with an unrelated slow job
    hc("send", "gjh-recv-busy", "Run the shell command `node -e \"setTimeout(()=>{},70000)\"` and wait for it to finish, then reply done.");
    await waitState("gjh-recv-busy", "working", 60000);
    const sendsBefore = hcJson("get", "gjh-recv-busy").turn;
    await pi.prompt("/retry-limit on");
    const timer = setTimeout(() => pi.send("abort").catch(() => {}), 240000);
    await pi.prompt(PROMPT);
    clearTimeout(timer);
    await waitNotice(pi);
    const notice = pi.notices().find((n) => n.startsWith("Handoff "));
    const screen = hc("read", "gjh-recv-busy").stdout;
    results.push({ scenario: "busy-receiver", failed: failures(pi).length, handoffNotice: notice, handoffMessageDelivered: /astra-handoff depth=1/.test(screen), receiverTurnBefore: sendsBefore, receiverTurnAfter: hcJson("get", "gjh-recv-busy").turn });
    assert.match(notice, /^Handoff failed.*not idle/);
    assert.ok(!/astra-handoff depth=1/.test(screen), "nothing was typed into the busy receiver");
  } finally { await pi.close(); cleanup("gjh-recv-busy"); }
}

// ---------- 3. missing receiver ----------
{
  const dir = await project("proj-gone");
  const addr = launchReceiver("gjh-recv-gone", dir);
  await waitState("gjh-recv-gone", "idle");
  const pi = await piOpen(dir);
  try {
    await pi.prompt(`/handoff-auto on ${addr} --no-extra-cost`);
    await sleep(2500);
    assert.ok(pi.notices().some((n) => n.startsWith("Automatic handoff on")));
    cleanup("gjh-recv-gone");
    await sleep(2000);
    await pi.prompt("/retry-limit on");
    const timer = setTimeout(() => pi.send("abort").catch(() => {}), 240000);
    await pi.prompt(PROMPT);
    clearTimeout(timer);
    await waitNotice(pi);
    const notice = pi.notices().find((n) => n.startsWith("Handoff "));
    results.push({ scenario: "missing-receiver", failed: failures(pi).length, handoffNotice: notice, summaryKept: /Summary kept at/.test(notice) });
    assert.match(notice, /^Handoff failed.*(not found|not live)/);
    assert.match(notice, /Summary kept at/);
  } finally { await pi.close(); cleanup("gjh-recv-gone"); }
}

// ---------- 4. default off ----------
{
  const dir = await project("proj-default");
  const pi = await piOpen(dir);
  try {
    await pi.prompt("/handoff-auto status");
    await sleep(1500);
    const status = pi.notices().at(-1);
    const cfgFiles = existsSync(path.join(os.homedir(), ".pi", "agent", "handoff-config.json"));
    results.push({ scenario: "default-off", status, persistentConfigFile: cfgFiles });
    assert.match(status, /off/);
    assert.equal(cfgFiles, false);
  } finally { await pi.close(); }
}

const live = (hcJson("ls") ?? {}).terminals?.map((t) => t.address) ?? [];
console.log(JSON.stringify({ results, liveTerminalsAfter: live }, null, 2));
