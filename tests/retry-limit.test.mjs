import assert from "node:assert/strict";
import { test } from "node:test";
import register from "../extensions/retry-limit.js";

test("opt-in stops at three identical errors and resets for a new run", async () => {
  const hooks = new Map();
  let command;
  let aborts = 0;
  register({
    on: (event, fn) => hooks.set(event, fn),
    registerCommand: (_name, { handler }) => { command = handler; },
  });
  const ctx = { abort: () => { aborts++; }, ui: { notify() {} } };
  const result = (input, isError = true) => hooks.get("tool_result")({ toolName: "read", input, isError }, ctx);
  const first = { path: "missing", offset: 1 };
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
});
