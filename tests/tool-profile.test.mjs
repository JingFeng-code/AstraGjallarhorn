import assert from "node:assert/strict";
import { test } from "node:test";
import register from "../extensions/tool-profile.js";

test("profiles never enable tools omitted at startup and can restore the starting set", async () => {
  let active = ["read", "edit", "other"];
  let invoke;
  register({
    registerCommand: (_name, { handler }) => { invoke = handler; },
    getActiveTools: () => [...active],
    setActiveTools: (tools) => { active = tools; },
  });
  const ctx = { ui: { notify() {} } };
  await invoke("review", ctx);
  assert.deepEqual(active, ["read"]);
  await invoke("local", ctx);
  assert.deepEqual(active, ["read", "edit"]);
  await invoke("restore", ctx);
  assert.deepEqual(active, ["read", "edit", "other"]);
});

test("engineering profiles preserve available LSP and review tools; cloud still excludes bash", async () => {
  const initial = ["read","edit","bash","lsp_diagnostics","review_diff","workflow_begin","other"];
  let active = [...initial], invoke;
  register({registerCommand:(_n,{handler})=>invoke=handler,getActiveTools:()=>[...active],setActiveTools:t=>active=t});
  const ctx={ui:{notify(){}}};
  await invoke("local",ctx);
  assert.deepEqual(active,["read","edit","bash","lsp_diagnostics","review_diff","workflow_begin"]);
  await invoke("cloud",ctx);
  assert.deepEqual(active,["read","edit","lsp_diagnostics","review_diff","workflow_begin"]);
  await invoke("restore",ctx);
  assert.deepEqual(active,initial);
});
