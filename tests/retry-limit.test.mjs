import assert from "node:assert/strict";
import { test } from "node:test";
import register from "../extensions/retry-limit.js";

test("explicit off, default identical limit, and strict stops at three identical errors and resets for a new run", async () => {
  const hooks = new Map();
  let entries = [];
  let notification;
  let command;
  let aborts = 0;
  register({
    on: (event, fn) => hooks.set(event, fn),
    registerCommand: (_name, { handler }) => { command = handler; },
    appendEntry: (customType, data) => { entries.push({ type: "custom", customType, data }); },
  });
  const ctx = {
    abort: () => { aborts++; },
    ui: { notify(message) { notification = message; } },
    sessionManager: { getEntries: () => entries },
  };
  let id = 0;
  const result = (args, isError = true) => {
    const call = { toolName: "read", toolCallId: String(++id) };
    hooks.get("tool_execution_start")({ ...call, args });
    hooks.get("tool_execution_end")({ ...call, isError }, ctx);
  };
  const first = { path: "missing", offset: 1 };
  hooks.get("session_start")({}, ctx);
  await command("status", ctx);
  assert.equal(notification, "Retry limit on");
  await command("off", ctx);
  hooks.get("session_start")({}, ctx);
  await command("status", ctx);
  assert.equal(notification, "Retry limit off");
  for (let i = 0; i < 3; i++) result(first);
  assert.equal(aborts, 0);
  await command("on", ctx);
  result(first);
  result({ path: "other" });
  result(first, false);
  result(first);
  result({ offset: 1, path: "missing" });
  assert.equal(aborts, 0);
  result(first);
  result(first);
  assert.equal(aborts, 1);
  hooks.get("agent_start")();
  result(first);
  result(first);
  result(first);
  assert.equal(aborts, 2);

  await command("strict", ctx);
  hooks.get("session_start")({}, ctx);
  await command("status", ctx);
  assert.equal(notification, "Retry limit strict");
  hooks.get("agent_start")();
  result({ path: "first" });
  result({ path: "second" }, false);
  result({ path: "third" });
  result({ path: "fourth" });
  assert.equal(aborts, 2);
  result({ path: "fifth" });
  assert.equal(aborts, 3);
  await command("handoff", ctx);
  assert.match(notification, /3 consecutive failures/);
  assert.doesNotMatch(notification, /fifth/);
  entries = [];
  hooks.get("session_start")({}, ctx);
  await command("status", ctx);
  assert.equal(notification, "Retry limit on");
  hooks.get("agent_start")();
  result(first); result(first); result(first);
  assert.equal(aborts, 4);
});
