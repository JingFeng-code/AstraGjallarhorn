// Pinned Pi process + local scripted provider: tests discovery, not model intelligence.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startPi, piCli } from "./lib/pi-rpc.mjs";
const repo = fileURLToPath(new URL("../", import.meta.url));
const args = ["architect","correct","create-verification-skill"].flatMap(n => ["--skill",path.join(repo,"agent","skills",n,"SKILL.md")]);
const pi = await startPi({cli:piCli(), extensions:[], args, script:[{text:"fixture"}]});
try {
  await pi.prompt("Help me understand a project defect.");
  assert.equal(pi.requests.length,1);
  const prompt = pi.requests[0].messages.filter(m=>m.role==="system").map(m=>JSON.stringify(m.content)).join("\n");
  assert.match(prompt, /<name>architect<\/name>/);
  assert.match(prompt, /<name>correct<\/name>/);
  assert.doesNotMatch(prompt, /<name>create-verification-skill<\/name>/);
  const result = await pi.send("get_commands");
  assert.equal(result.success,true);
  for (const name of ["architect","correct","create-verification-skill"]) assert.ok(result.data.commands.some(c=>c.name==="skill:"+name));
  console.log("PASS: native Pi advertises architect/correct; generator remains explicit-only");
} finally { await pi.close(); }
