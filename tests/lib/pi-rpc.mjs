// Shared harness: scripted OpenAI-compatible provider + real Pi RPC process.
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, copyFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

// script: array of steps. step = { text } | { tools: [{name, args}] } | function(requestBody, n) => step
export async function startPi({ cli, script, extensions, extraFiles = {}, env = {}, cwdSetup, args = [] }) {
  const cwd = await mkdtemp(path.join(tmpdir(), "astra-rpc-"));
  const agent = path.join(cwd, "agent");
  const work = path.join(cwd, "work");
  await mkdir(path.join(agent, "extensions"), { recursive: true });
  await mkdir(work, { recursive: true });
  for (const name of extensions) await copyFile(path.join(repoRoot, "extensions", name), path.join(agent, "extensions", name));
  for (const [rel, content] of Object.entries(extraFiles)) {
    await mkdir(path.dirname(path.join(cwd, rel)), { recursive: true });
    await writeFile(path.join(cwd, rel), content);
  }
  if (cwdSetup) await cwdSetup(work, cwd);
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    let parsed = {};
    try { parsed = JSON.parse(body); } catch { /* keep empty */ }
    requests.push(parsed);
    const n = requests.length;
    let step = typeof script === "function" ? script(parsed, n) : script[n - 1];
    if (typeof step === "function") step = step(parsed, n);
    step ??= { text: "SCRIPT EXHAUSTED" };
    const chunk = (delta, finish_reason) => JSON.stringify({
      id: "t", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }],
    });
    const tools = (step.tools ?? []).map((t, i) => ({
      index: i, id: `call_${n}_${i}`, type: "function", function: { name: t.name, arguments: JSON.stringify(t.args) },
    }));
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const first = tools.length ? { role: "assistant", tool_calls: tools } : { role: "assistant", content: step.text ?? "" };
    res.end(`data: ${chunk(first, null)}\n\ndata: ${chunk({}, tools.length ? "tool_calls" : "stop")}\n\ndata: [DONE]\n\n`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  await writeFile(path.join(agent, "models.json"), JSON.stringify({
    providers: { fixture: {
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: "openai-completions", apiKey: "fixture-only", models: [{ id: "fixture" }],
    } },
  }));
  const child = spawn(process.execPath, [
    path.resolve(cli), "--offline", "--no-mcp", "--no-skills", "--no-context-files", "--mode", "rpc", "--provider", "fixture", "--model", "fixture", ...args,
  ], { cwd: work, env: { ...process.env, PI_CODING_AGENT_DIR: agent, ...env } });
  child.stderr.on("data", (d) => process.stderr.write(d));
  const rl = createInterface({ input: child.stdout });
  const events = [];
  const waiters = [];
  let counter = 0;
  rl.on("line", (line) => {
    if (!line.startsWith("{")) return;
    const event = JSON.parse(line);
    events.push(event);
    for (const w of [...waiters]) if (w.test(event)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(event); }
    if (event.type === "extension_ui_request" && event.method === "confirm") {
      const answer = harness.confirmAnswer ?? false;
      child.stdin.write(JSON.stringify({ type: "extension_ui_response", id: event.id, confirmed: answer }) + "\n");
    }
  });
  const waitFor = (test, ms = 60000, label = "event") => new Promise((resolve, reject) => {
    const hit = events.find(test);
    if (hit) return resolve(hit);
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${label}; requests=${requests.length}`)), ms);
    waiters.push({ test, resolve: (e) => { clearTimeout(timer); resolve(e); } });
  });
  const harness = {
    cwd, agent, work, events, requests, confirmAnswer: false,
    send(type, extra = {}) {
      const id = `c${++counter}`;
      child.stdin.write(JSON.stringify({ id, type, ...extra }) + "\n");
      return waitFor((e) => e.type === "response" && e.id === id, 30000, `response ${type}`);
    },
    async prompt(message) {
      const before = events.filter((e) => e.type === "agent_end").length;
      const res = await harness.send("prompt", { message });
      if (!res.success) throw new Error(res.error);
      if (!message.startsWith("/")) await waitFor(() => events.filter((e) => e.type === "agent_end").length > before, 60000, "agent_end");
      return res;
    },
    notices: () => events.filter((e) => e.type === "extension_ui_request" && e.method === "notify").map((e) => e.message),
    toolEnds: () => events.filter((e) => e.type === "tool_execution_end"),
    waitFor,
    async close() {
      rl.close();
      if (child.exitCode === null && child.signalCode === null) await new Promise((resolve) => { child.once("exit", resolve); child.kill(); });
      server.close();
      await rm(cwd, { recursive: true, force: true, maxRetries: 3 });
    },
  };
  await harness.send("get_state");
  return harness;
}

export const piCli = () => path.resolve(process.argv[2] ?? process.env.PI_CLI ?? "");
