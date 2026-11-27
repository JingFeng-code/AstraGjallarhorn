import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, copyFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const cli = path.resolve(process.argv[2]);
const cwd = await mkdtemp(path.join(tmpdir(), "astra-retry-rpc-"));
const agent = path.join(cwd, "agent");
await mkdir(path.join(agent, "extensions"), { recursive: true });
const source = fileURLToPath(new URL("../extensions/retry-limit.js", import.meta.url));
await copyFile(source, path.join(agent, "extensions", "retry-limit.js"));
await writeFile(path.join(agent, "extensions", "reload-test.js"), `
export default (pi) => pi.registerCommand("fixture-reload", {
  description: "Reload fixture",
  handler: async (_args, ctx) => ctx.reload(),
});
`);
let count = 0;
const server = createServer(async (req, res) => {
  for await (const _ of req) {}
  count++;
  const toolCall = {
    index: 0, id: `call_${count}`, type: "function",
    function: { name: "bash", arguments: JSON.stringify({ command: `exit ${count}` }) },
  };
  const delta = count <= 3
    ? { role: "assistant", tool_calls: [toolCall] }
    : { role: "assistant", content: "NOT STOPPED" };
  const chunk = (delta, finish_reason) => JSON.stringify({
    id: "test", object: "chat.completion.chunk", created: 1, model: "fixture",
    choices: [{ index: 0, delta, finish_reason }],
  });
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.end(`data: ${chunk(delta, null)}\n\ndata: ${chunk({}, count <= 3 ? "tool_calls" : "stop")}\n\ndata: [DONE]\n\n`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
await writeFile(path.join(agent, "models.json"), JSON.stringify({
  providers: { fixture: {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    api: "openai-completions", apiKey: "fixture-only", models: [{ id: "fixture" }],
  } },
}));
const child = spawn(process.execPath, [
  cli, "--offline", "--no-session", "--no-mcp", "--no-skills", "--no-context-files",
  "--mode", "rpc", "--provider", "fixture", "--model", "fixture",
], { cwd, env: { ...process.env, PI_CODING_AGENT_DIR: agent } });
child.stderr.pipe(process.stderr);
const output = createInterface({ input: child.stdout });
const send = (id, type, message) => child.stdin.write(JSON.stringify({ id, type, message }) + "\n");
let errors = 0;
let notice;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`RPC deadline, requests=${count}`)), 30000);
    child.once("exit", (code) => { clearTimeout(timer); reject(Error(`Unexpected Pi exit ${code}`)); });
    output.on("line", (line) => {
      if (!line.startsWith("{")) return;
      const event = JSON.parse(line);
      if (event.type === "response") {
        if (!event.success) {
          clearTimeout(timer);
          return reject(Error(event.error));
        }
        if (event.id === "1") send("2", "prompt", "/fixture-reload");
        if (event.id === "2") send("3", "prompt", "Follow fixture.");
        if (event.id === "4") send("5", "prompt", "/retry-limit status");
      }
      if (event.type === "tool_execution_end" && event.isError) errors++;
      if (event.type === "agent_end") send("6", "prompt", "/retry-limit handoff");
      if (event.type !== "extension_ui_request" || event.method !== "notify") return;
      if (event.message.startsWith("Retry limit stopped")) notice = event.message;
      const level = event.level ?? event.notifyType;
      if (level === "info" && event.message.includes("3 consecutive failures")) send("4", "new_session");
      if (event.message === "Retry limit on") {
        clearTimeout(timer);
        resolve();
      }
    });
    send("1", "prompt", "/retry-limit strict");
  });
  assert.equal(count, 3);
  assert.equal(errors, 3);
  assert.match(notice, /stopped bash after 3 consecutive failures/);
  console.log("PASS: strict mode survives reload, stops after three different shell errors, saves handoff, and defaults to identical-call limit in a new session");
} finally {
  output.close();
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise((resolve) => { child.once("exit", resolve); child.kill(); });
  }
  server.close();
  await rm(cwd, { recursive: true, force: true });
}
