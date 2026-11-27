import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const cli = path.resolve(process.argv[2]);
const repo = fileURLToPath(new URL("../", import.meta.url));
const root = await mkdtemp(path.join(tmpdir(), "astra-mode-"));
const agent = path.join(root, "agent");
const home = path.join(root, "home");
const cwd = path.join(root, "work");
const legacy = path.join(agent, "mode-state.json");
const children = [];

function start() {
  const env = {
    SystemRoot: process.env.SystemRoot,
    PATH: process.env.PATH,
    TEMP: root,
    TMP: root,
    HOME: home,
    USERPROFILE: home,
    APPDATA: home,
    LOCALAPPDATA: home,
    XDG_CONFIG_HOME: home,
    PI_CODING_AGENT_DIR: agent,
  };
  const child = spawn(process.execPath, [cli, "--mode", "rpc", "--offline"], {
    cwd, env, stdio: ["pipe", "pipe", "pipe"],
  });
  children.push(child);
  let sequence = 0;
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const output = createInterface({ input: child.stdout });
  return (type, args = {}) => new Promise((resolve, reject) => {
    const id = String(++sequence);
    function cleanup() {
      clearTimeout(timer);
      output.off("line", onLine);
      child.off("exit", onExit);
    }
    function onExit(code) {
      cleanup();
      reject(new Error(`Pi exited ${code} during ${type}\n${stderr}`));
    }
    function onLine(line) {
      const record = JSON.parse(line);
      if (record.id !== id || record.type !== "response") return;
      cleanup();
      if (record.success) resolve(record.data);
      else reject(new Error(record.error));
    }
    const timer = setTimeout(() => onExit("timeout"), 12000);
    child.once("exit", onExit);
    output.on("line", onLine);
    child.stdin.write(JSON.stringify({ id, type, ...args }) + "\n");
  });
}

async function expectMode(rpc, count) {
  const { commands } = await rpc("get_commands");
  assert(commands.some(({ name, source }) => name === "mode" && source === "extension"));
  assert.equal(commands.filter(({ name }) => name.startsWith("skill:ds-")).length, count);
}

try {
  await Promise.all([agent, home, cwd].map((dir) => mkdir(dir, { recursive: true })));
  await cp(path.join(repo, "extensions"), path.join(agent, "extensions"), { recursive: true });
  await cp(path.join(repo, "modes"), path.join(root, "modes"), { recursive: true });
  if (process.argv[3]) {
    const skillDir = path.resolve(process.argv[3]);
    const names = ["architect", "correct", "create-verification-skill"];
    for (const name of names) {
      const source = path.join(skillDir, name, "SKILL.md");
      const body = await readFile(source, "utf8");
      assert.equal(/^disable-model-invocation: true$/m.test(body), name === "create-verification-skill");
      await mkdir(path.join(agent, "skills", name), { recursive: true });
      await cp(source, path.join(agent, "skills", name, "SKILL.md"));
    }
    const { commands } = await start()("get_commands");
    for (const name of names) {
      assert(commands.some((command) => command.name === `skill:${name}` && command.source === "skill"));
    }
    console.log("PASS: Pi discovers three pstack skill commands (two model-visible, generator explicit-only)");
  }
  const a = start();
  const b = start();
  await Promise.all([expectMode(a, 0), expectMode(b, 0)]);
  const initial = await a("get_state");
  await b("prompt", { message: "/mode use deep-execution" });
  await expectMode(b, 7);
  await expectMode(a, 0);
  await a("prompt", { message: "/mode toggle" });
  await b("prompt", { message: "/mode use default" });
  await Promise.all([expectMode(a, 7), expectMode(b, 0)]);
  const switched = await a("get_state");
  assert.deepEqual(switched.model, initial.model);
  assert.equal(switched.thinkingLevel, initial.thinkingLevel);
  await a("new_session");
  await expectMode(a, 0);
  const sessionPath = path.join(root, "saved.jsonl");
  const timestamp = new Date().toISOString();
  const entries = [
    { type: "session", version: 3, id: randomUUID(), timestamp, cwd },
    { type: "custom", id: "10000001", parentId: null, timestamp, customType: "astragjallarhorn-mode", data: { mode: "deep-execution" } },
    { type: "message", id: "10000002", parentId: "10000001", timestamp, message: { role: "user", content: [{ type: "text", text: "Fixture" }], timestamp: Date.now() } },
  ];
  await writeFile(sessionPath, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  await a("switch_session", { sessionPath });
  await expectMode(a, 7);
  await a("fork", { entryId: "10000002" });
  assert.notEqual((await a("get_state")).sessionFile, sessionPath);
  await expectMode(a, 7);
  await a("prompt", { message: "/mode use default" });
  await expectMode(a, 0);
  await a("switch_session", { sessionPath });
  await expectMode(a, 7);
  await writeFile(legacy, "{bad json");
  await expectMode(start(), 0);
  await writeFile(legacy, '{"mode":"deep-execution"}');
  const migrated = start();
  await expectMode(migrated, 7);
  await migrated("prompt", { message: "/mode use default" });
  await expectMode(migrated, 0);
  assert.equal(await readFile(legacy, "utf8"), '{"mode":"deep-execution"}');
  console.log("PASS: Pi RPC, two simultaneous sessions, mode command/reload, new session, resume/fork, legacy default, malformed state, unchanged model/thinking");
} finally {
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    await new Promise((resolve) => {
      child.once("exit", resolve);
      child.kill();
    });
  }
  await rm(root, { recursive: true, force: true });
}
