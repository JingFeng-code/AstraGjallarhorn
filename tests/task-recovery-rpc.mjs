import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startPi, piCli } from "./lib/pi-rpc.mjs";

const base = await mkdtemp(path.join(tmpdir(), "astra-recover-"));
const extensions = ["task-recovery.js"];
const first = await startPi({
  cli: piCli(), extensions, baseDir: base, keep: true,
  cwdSetup: (work) => writeFile(path.join(work, "slow.js"), "setTimeout(() => {}, 600000);\n"),
  script: [
    { tools: [{ name: "bash", args: { command: "echo one > a.txt" } }] },
    { tools: [{ name: "bash", args: { command: "node slow.js" } }] },
  ],
});
try {
  first.send("prompt", { message: "create a.txt then run the slow deploy" }).catch(() => {});
  await first.waitFor((e) => e.type === "tool_execution_start" && JSON.stringify(e.args).includes("slow.js"), 30000, "slow tool start");
  await new Promise((r) => setTimeout(r, 500));
  await first.crash(); // hard kill: no agent_end, no shutdown hooks
} catch (error) { await first.crash().catch(() => {}); throw error; }

const second = await startPi({ cli: piCli(), extensions, baseDir: base, keep: true, script: [
  { tools: [{ name: "bash", args: { command: "echo two > b.txt" } }] },
  { tools: [{ name: "bash", args: { command: "node ./slow.js" } }] },
] });
try {
  await second.waitFor((e) => e.type === "extension_ui_request" && String(e.message).includes("Unfinished task"), 15000, "recovery notice");
  const notice = second.notices().find((n) => n.includes("Unfinished task"));
  assert.match(notice, /1 calls completed, 1 outcome-unknown/);
  const id = notice.match(/task (\S+) found/)[1];
  second.send("prompt", { message: "/task resume" }).catch(() => {});
  await second.waitFor(() => second.requests.length >= 1, 30000, "resume request");
  const sent = JSON.stringify(second.requests[0].messages);
  assert.match(sent, /astra-resume/);
  assert.match(sent, /echo one > a\.txt/);
  assert.match(sent, /node slow\.js/);
  assert.match(sent, /may have changed state/);
  assert.match(sent, /Never re-run it blindly/);
  await second.waitFor((e) => e.type === "tool_execution_start" && JSON.stringify(e.args).includes("./slow.js"), 30000, "second slow tool start");
  await new Promise((r) => setTimeout(r, 500));
  await second.crash();
  const journal = JSON.parse(await readFile(path.join(base, "agent", "tasks", `${id}.json`), "utf8"));
  assert.equal(journal.status, "interrupted");
  assert.match(journal.resumedBy, /pid/);
} catch (error) { await second.crash().catch(() => {}); throw error; }

const third = await startPi({ cli: piCli(), extensions, baseDir: base, keep: true, script: [{ text: "continuing after verification" }] });
try {
  await third.waitFor((e) => e.type === "extension_ui_request" && String(e.message).includes("Unfinished task"), 15000, "second recovery notice");
  const notice = third.notices().find((n) => n.includes("Unfinished task"));
  assert.match(notice, /2 calls completed, 2 outcome-unknown/);
  const id = notice.match(/task (\S+) found/)[1];
  await third.prompt("/task resume");
  await third.waitFor(() => third.requests.length >= 1, 30000, "second resume request");
  const sent = JSON.stringify(third.requests[0].messages);
  for (const item of ["create a.txt then run the slow deploy", "echo one > a.txt", "echo two > b.txt", "node slow.js", "node ./slow.js"]) {
    assert.ok(sent.includes(item), `missing inherited context: ${item}`);
  }
  await third.waitFor((e) => e.type === "agent_end", 30000, "second resume agent_end");
  await third.prompt("/task resume " + id);
  await third.waitFor(() => third.notices().some((n) => /already continued/.test(n)), 5000, "duplicate refusal");
  assert.ok(third.notices().some((n) => /already continued/.test(n)), "duplicate resume refused");
  assert.equal(third.requests.length, 1, "no duplicate dispatch");
  console.log("PASS task recovery: two killed Pi processes, inherited original request and tool outcomes, duplicate continuation refused");
} finally { await third.close(); await rm(base, { recursive: true, force: true }); }

// Timeout: the task is cancelled, journalled as timeout, and its child process tree is gone.
import { execFileSync } from "node:child_process";
const marker = `slow-timeout-${process.pid}.js`;
const timed = await startPi({
  cli: piCli(), extensions, env: { ASTRA_TASK_TIMEOUT_MIN: "0.04" },
  cwdSetup: (work) => writeFile(path.join(work, marker), "setTimeout(() => {}, 600000);\n"),
  script: [{ tools: [{ name: "bash", args: { command: `node ${marker}` } }] }, { text: "never reached" }],
});
const running = () => execFileSync("pwsh", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${marker}*' -and $_.Name -eq 'node.exe' } | Measure-Object).Count`], { encoding: "utf8" }).trim();
try {
  await timed.prompt("run the slow thing");
  const dir = path.join(timed.agent, "tasks");
  const file = (await readdir(dir)).find((f) => f.endsWith(".json"));
  const journal = JSON.parse(await readFile(path.join(dir, file), "utf8"));
  assert.equal(journal.status, "timeout");
  assert.ok(timed.notices().some((n) => /exceeded 0\.04 minutes/.test(n)));
  assert.equal(timed.requests.length, 1, "the agent did not continue after cancellation");
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(running(), "0", "no leftover child process");
  console.log("PASS task recovery: timeout cancels the task, is journalled, and leaves no child process");
} finally { await timed.close(); }
