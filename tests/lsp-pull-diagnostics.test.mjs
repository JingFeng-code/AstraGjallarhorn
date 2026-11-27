import assert from "node:assert/strict";
import test from "node:test";
import { LspClient } from "../extensions/lsp.js";

function clientWithPullProviders(request) {
  const client = Object.create(LspClient.prototype);
  client.serverCapabilities = { diagnosticProvider: {} };
  client.registrations = [
    { method: "textDocument/diagnostic", registerOptions: { identifier: "syntax" } },
    { method: "textDocument/diagnostic", registerOptions: { identifier: "semantic" } },
  ];
  client.sync = async () => ({ uri: "file:///workspace/main.ts", version: 7 });
  client.request = request;
  client.log = () => {};
  return client;
}

test("partial pull diagnostics are inconclusive when a provider fails", async () => {
  const client = clientWithPullProviders(async (_method, params) => {
    if (params.identifier === "syntax") return { kind: "full", items: [] };
    throw new Error("semantic provider timed out");
  });

  const result = await client.diagnose("/workspace/main.ts", "typescript");
  assert.equal(result.diagnostics, undefined, "a partial empty report must not be treated as CLEAN");
});

test("complete pull diagnostics combine every provider", async () => {
  const client = clientWithPullProviders(async (_method, params) => ({
    kind: "full",
    items: params.identifier === "syntax" ? [{ code: "TS1005", severity: 1 }] : [{ code: "TS2339", severity: 2 }],
  }));

  const result = await client.diagnose("/workspace/main.ts", "typescript");
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["TS1005", "TS2339"]);
});

test("malformed full diagnostic reports are inconclusive", async () => {
  const client = clientWithPullProviders(async (_method, params) => ({
    kind: "full",
    ...(params.identifier === "syntax" ? { items: [] } : {}),
  }));

  const result = await client.diagnose("/workspace/main.ts", "typescript");
  assert.equal(result.diagnostics, undefined);
});

test("unchanged pull diagnostics without a previous result are inconclusive", async () => {
  const client = clientWithPullProviders(async (_method, params) =>
    params.identifier === "syntax" ? { kind: "full", items: [] } : { kind: "unchanged", resultId: "previous" });

  const result = await client.diagnose("/workspace/main.ts", "typescript");
  assert.equal(result.diagnostics, undefined);
});
