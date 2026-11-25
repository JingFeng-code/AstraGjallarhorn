import assert from "node:assert/strict";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startPi, piCli } from "./lib/pi-rpc.mjs";

const stateFile = path.join(tmpdir(), `astra-fake-hc-${process.pid}.json`);
const pi = await startPi({
  cli: piCli(),
  extensions: ["retry-limit.js", "handoff.js"],
  env: { ASTRA_HC_NODE: fileURLToPath(new URL("./lib/fake-hc.mjs", import.meta.url)), FAKE_HC_STATE: stateFile },
  script: [1, 2, 3, 4].map(() => ({ tools: [{ name: "bash", args: { command: "exit 1" } }] })),
});
const writeState = (extra = {}) => writeFile(stateFile, JSON.stringify({ address: "t9", cwd: pi.work, agent: "opencode", status: "idle", turn: 0, ...extra }));
try {
  await writeState();
  await pi.prompt("/handoff-auto on t9 --no-extra-cost");
  await pi.waitFor(() => pi.notices().some((n) => n.startsWith("Automatic handoff on")), 15000, "enable notice");
  await pi.prompt("/retry-limit on");
  await pi.prompt("verify and fix the build");
  await pi.waitFor(() => pi.notices().some((n) => n.startsWith("Handoff ")), 20000, "handoff notice");
  assert.equal(pi.requests.length, 3, "Pi stopped after the third failure");
  const notice = pi.notices().find((n) => n.startsWith("Handoff "));
  assert.match(notice, /^Handoff received/);
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(state.sent.length, 1);
  const files = await readdir(path.join(pi.agent, "handoffs"));
  const summary = await readFile(path.join(pi.agent, "handoffs", files.find((f) => f.endsWith(".md"))), "utf8");
  assert.match(summary, /verify and fix the build/);
  assert.match(summary, /3 identical failures/);
  console.log("PASS handoff: third failure stops Pi, one handoff reaches the idle same-directory receiver, evidence file written");
} finally { await pi.close(); }

// Off by default: no enabling, no hc interaction.
const quiet = await startPi({
  cli: piCli(), extensions: ["retry-limit.js", "handoff.js"],
  env: { ASTRA_HC_NODE: fileURLToPath(new URL("./lib/fake-hc.mjs", import.meta.url)), FAKE_HC_STATE: stateFile },
  script: [1, 2, 3, 4].map(() => ({ tools: [{ name: "bash", args: { command: "exit 1" } }] })),
});
try {
  await writeFile(stateFile, JSON.stringify({ address: "t9", cwd: quiet.work, agent: "opencode", status: "idle", turn: 0 }));
  await quiet.prompt("/retry-limit on");
  await quiet.prompt("verify");
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(quiet.requests.length, 3);
  assert.ok(!quiet.notices().some((n) => n.startsWith("Handoff ")));
  assert.equal(JSON.parse(await readFile(stateFile, "utf8")).sent, undefined);
  console.log("PASS handoff: disabled by default, manual handoff only");
} finally { await quiet.close(); }
