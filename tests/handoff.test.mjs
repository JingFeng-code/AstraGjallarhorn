import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { performHandoff } from "../extensions/handoff.js";

const fake = fileURLToPath(new URL("./lib/fake-hc.mjs", import.meta.url));
async function setup(overrides = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "astra-handoff-"));
  const stateFile = path.join(dir, "state.json");
  const cwd = path.join(dir, "project");
  const state = { address: "t9", live: true, cwd, agent: "opencode", status: "idle", turn: 0, ...overrides };
  await writeFile(stateFile, JSON.stringify(state));
  const runHc = (args) => new Promise((resolve) => execFile(process.execPath, [fake, ...args], { env: { ...process.env, FAKE_HC_STATE: stateFile } },
    (error, stdout, stderr) => resolve({ ok: !error, code: error?.code ?? 0, stdout, stderr })));
  const read = async () => JSON.parse(await readFile(stateFile, "utf8"));
  const log = async () => (await readFile(`${stateFile}.log`, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { dir, cwd, runHc, read, log, handoffs: path.join(dir, "handoffs") };
}
const failure = { reason: "3 identical failures", tool: "bash", policy: "on", args: { command: "node verify.mjs" }, error: "exit 1" };
const config = (extra = {}) => ({ enabled: true, target: "t9", agent: "opencode", ...extra });
const run = (s, over = {}) => performHandoff({
  config: config(over.config), failure: over.failure ?? failure, runHc: s.runHc, dir: s.handoffs, sleep: async () => {}, confirmMs: 100,
  ctxInfo: { cwd: s.cwd, sessionId: "self", taskKey: "k1", task: "fix the migration", inheritedDepth: 0, git: "M a.sql", ...over.ctx },
});

test("hands off once to an idle receiver in the same directory and confirms acceptance", async () => {
  const s = await setup();
  try {
    const out = await run(s);
    assert.equal(out.status, "received");
    const state = await s.read();
    assert.equal(state.sent.length, 1);
    assert.match(state.sent[0], /astra-handoff depth=1/);
    assert.ok(state.sent[0].length < 400, "the pasted line is short; the evidence lives in the file");
    const summary = await readFile(out.file, "utf8");
    assert.match(summary, /fix the migration/);
    assert.match(summary, /node verify\.mjs/);
    assert.match(summary, /M a\.sql/);
    // second identical failure must not dispatch again
    const again = await run(s);
    assert.equal(again.status, "blocked");
    assert.equal((await s.read()).sent.length, 1);
  } finally { await rm(s.dir, { recursive: true, force: true }); }
});

test("refuses without sending: off, busy, wrong cwd, missing, swapped agent, self, loop", async () => {
  const cases = [
    ["off", {}, { config: { enabled: false } }, /off/],
    ["busy", { status: "working" }, {}, /not idle/],
    ["cwd", { cwd: "C:\somewhere\else" }, {}, /working directory differs/],
    ["missing", {}, { config: { target: "t404" } }, /not found/],
    ["agent swapped", { agent: "claude" }, {}, /agent changed/],
    ["self", { session: "self" }, {}, /this very Pi session/],
    ["dead", { live: false }, {}, /not live/],
    ["loop", {}, { ctx: { inheritedDepth: 1 } }, /loop prevention/],
  ];
  for (const [name, state, over, pattern] of cases) {
    const s = await setup(state);
    try {
      const out = await run(s, over);
      assert.notEqual(out.status, "received", name);
      assert.match(out.detail, pattern, name);
      assert.ok(!(await s.log()).some((l) => l.cmd === "send"), `${name}: nothing was sent`);
      if (out.file) assert.match(await readFile(out.file, "utf8"), /fix the migration/, `${name}: summary is kept`);
    } finally { await rm(s.dir, { recursive: true, force: true }); }
  }
});

test("send failure keeps the summary and is never retried; unconfirmed acceptance is never resent", async () => {
  const s = await setup({ behavior: "fail" });
  try {
    const out = await run(s);
    assert.equal(out.status, "failed");
    assert.ok(out.file);
    assert.equal((await run(s)).status, "blocked");
    assert.equal((await s.log()).filter((l) => l.cmd === "send").length, 1);
  } finally { await rm(s.dir, { recursive: true, force: true }); }
  const t = await setup({ behavior: "ignore" });
  try {
    const out = await run(t);
    assert.equal(out.status, "unconfirmed");
    assert.equal((await run(t)).status, "blocked");
    assert.equal((await t.log()).filter((l) => l.cmd === "send").length, 1);
  } finally { await rm(t.dir, { recursive: true, force: true }); }
});

test("hourly cap stops runaway handoffs", async () => {
  const s = await setup();
  try {
    for (let i = 0; i < 3; i++) {
      const out = await run(s, { failure: { ...failure, args: { command: `x${i}` } } });
      assert.equal(out.status, "received", `handoff ${i}`);
      const state = await s.read(); state.status = "idle"; await writeFile(path.join(s.dir, "state.json"), JSON.stringify(state));
    }
    const out = await run(s, { failure: { ...failure, args: { command: "x9" } } });
    assert.equal(out.status, "blocked");
    assert.match(out.detail, /cap/);
  } finally { await rm(s.dir, { recursive: true, force: true }); }
});

test("secrets are masked in the summary file", async () => {
  const { redact } = await import("../extensions/handoff.js");
  const samples = [
    ["curl -H 'Authorization: Bearer abcdef1234567890XYZ' https://x", /abcdef1234567890XYZ/],
    ["export OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwx", /sk-abcdefghijklmnop/],
    ["token=ghp_abcdefghijklmnopqrstuvwxyz0123456789", /ghp_abcdefghij/],
    ["git clone https://user:hunter2pass@github.com/a/b.git", /hunter2pass/],
    ['{"password": "s3cr3t-value"}', /s3cr3t-value/],
    ["npm login --password hunter2 --user a", /hunter2/],
    ["AKIAABCDEFGHIJKLMNOP", /AKIAABCDEFGHIJKLMNOP/],
    ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk", /eyJhbGciOiJIUzI1NiJ9/],
    ["-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----", /MIIabc/],
  ];
  for (const [input, leak] of samples) assert.doesNotMatch(redact(input), leak, input);
  assert.equal(redact("node verify.mjs --suite sql"), "node verify.mjs --suite sql", "ordinary commands are untouched");

  const s = await setup();
  try {
    const out = await run(s, { failure: { ...failure, args: { command: "deploy --token abc123secret" }, error: "401 Authorization: Bearer zzzzzzzzzz12345" }, ctx: { task: "use password=hunter2 to log in" } });
    const summary = await readFile(out.file, "utf8");
    assert.doesNotMatch(summary, /abc123secret|zzzzzzzzzz12345|hunter2/);
    assert.match(summary, /REDACTED/);
  } finally { await rm(s.dir, { recursive: true, force: true }); }
});

test("concurrent handoffs of the same failure send exactly once", async () => {
  const s = await setup();
  try {
    const outcomes = await Promise.all([run(s), run(s), run(s), run(s)]);
    assert.equal(outcomes.filter((o) => o.status === "received").length, 1, JSON.stringify(outcomes.map((o) => o.status)));
    assert.equal((await s.log()).filter((l) => l.cmd === "send").length, 1);
    const ledger = JSON.parse(await readFile(path.join(s.handoffs, "ledger.json"), "utf8"));
    assert.equal(ledger.entries.length, 1, "no lost or duplicated ledger entries");
  } finally { await rm(s.dir, { recursive: true, force: true }); }
});

test("different failures to the same busy-sending receiver are serialised", async () => {
  const s = await setup();
  try {
    const outcomes = await Promise.all([1, 2, 3].map((i) => run(s, { failure: { ...failure, args: { command: `x${i}` } } })));
    assert.equal((await s.log()).filter((l) => l.cmd === "send").length, outcomes.filter((o) => o.status === "received").length);
    assert.ok(outcomes.filter((o) => o.status === "received").length <= 1, JSON.stringify(outcomes.map((o) => o.status)));
  } finally { await rm(s.dir, { recursive: true, force: true }); }
});

test("unreadable or invalid ledger is preserved and blocks dispatch", async () => {
  for (const raw of ["{", "null", '{"entries":null}', '{"entries":[{}]}']) {
    const s = await setup();
    try {
      const first = await run(s);
      assert.equal(first.status, "received");
      const file = path.join(s.handoffs, "ledger.json");
      await writeFile(file, raw);
      const out = await run(s);
      assert.equal(out.status, "blocked");
      assert.match(out.detail, /ledger unavailable/);
      assert.equal(await readFile(file, "utf8"), raw, "do not overwrite ambiguous evidence");
      assert.equal((await s.log()).filter((l) => l.cmd === "send").length, 1);
    } finally { await rm(s.dir, { recursive: true, force: true }); }
  }
});
