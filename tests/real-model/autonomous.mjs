// Opt-in local Ollama acceptance. No downloads, no formal Pi changes, no cloud provider.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startPi } from "../lib/pi-rpc.mjs";

const [cli, model] = process.argv.slice(2);
if (!cli || !model || /cloud|remote/i.test(model)) {
  throw Error("Usage: node tests/real-model/autonomous.mjs <pi cli.js> <installed local model>");
}
const tags = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(5000) });
assert.ok(tags.ok, "Local Ollama must be running");
const installed = (await tags.json()).models.find(m => m.name === model || m.name === model + ":latest");
assert.ok(installed && installed.size > 0 && !installed.remote_model && !installed.remote_host && !/cloud|remote/i.test(installed.name), "Use an already downloaded local model; no pulls or remote models");
const repo = fileURLToPath(new URL("../../", import.meta.url));
const rules = await readFile(path.join(repo,"agent","AGENTS.md"),"utf8");
const skills = ["architect","correct"].flatMap(n=>["--skill",path.join(repo,"agent","skills",n,"SKILL.md")]);
const source = "export function total(price, quantity, discount) {\n  return price * quantity - discount;\n}\n";
const tests = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { total } from './pricing.mjs';\ntest('no discount', () => assert.equal(total(100, 2, 0), 200));\ntest('10 percent discount on 2 items', () => assert.equal(total(100, 2, 10), 180));\ntest('100 percent discount', () => assert.equal(total(100, 2, 100), 0));\n";
const readme = "# Order pricing\nThe discount parameter is a percentage (0 to 100).\nRun the regression checks with: node --test pricing.test.mjs\n";
const git = (cwd,...args)=>execFileSync("git",args,{cwd,encoding:"utf8",timeout:30000});
const verify = cwd=>spawnSync(process.execPath,["--test","pricing.test.mjs"],{cwd,encoding:"utf8",timeout:30000});
const pi = await startPi({
  cli, real:{model:installed.name}, script:[],
  extensions:["command-guard.js","checkpoint.js","retry-limit.js","diff-review.js"],
  args:["--append-system-prompt",rules,...skills,"--tools","read,edit,bash,review_diff"],
  cwdSetup:async work=>{
    await writeFile(path.join(work,"pricing.mjs"),source);
    await writeFile(path.join(work,"pricing.test.mjs"),tests);
    await writeFile(path.join(work,"README.md"),readme);
    git(work,"init","-q");
    git(work,"add","-A");
    git(work,"-c","user.name=Astra Simulation","-c","user.email=simulation@example.invalid","commit","-qm","fixture");
  }
});
try {
  const before = verify(pi.work);
  assert.equal(before.status,1,"Fixture must fail before agent starts");
  const head = git(pi.work,"rev-parse","HEAD").trim();
  const timer = setTimeout(()=>pi.send("abort").catch(()=>{}),300000);
  try { await pi.prompt("業主說訂單折扣金額計算錯誤，幫我查原因並修好。"); }
  finally { clearTimeout(timer); }
  const after = verify(pi.work);
  const starts = new Map(pi.events.filter(e=>e.type==="tool_execution_start").map(e=>[e.toolCallId,e]));
  const calls = pi.toolEnds().map(e=>({name:e.toolName,failed:e.isError===true,args:starts.get(e.toolCallId)?.args}));
  const isCheck = c => c.name==="bash" && /^\s*node\s+--test(?:\s+pricing\.test\.mjs)?\s*$/.test(c.args?.command??"");
  const edit = calls.findIndex(c=>c.name==="edit"&&!c.failed);
  const sawFail = edit>=0 && calls.slice(0,edit).some(c=>isCheck(c)&&c.failed);
  const sawPass = edit>=0 && calls.slice(edit+1).some(c=>isCheck(c)&&!c.failed);
  const status = git(pi.work,"status","--porcelain").trim();
  const unchangedTests = await readFile(path.join(pi.work,"pricing.test.mjs"),"utf8")===tests;
  const unchangedDocs = await readFile(path.join(pi.work,"README.md"),"utf8")===readme;
  const unchangedHead = git(pi.work,"rev-parse","HEAD").trim()===head;
  const review = calls.some(c=>c.name==="review_diff"&&!c.failed);
  const result = {model:installed.name,independentBefore:before.status,independentAfter:after.status,modelReproduced:sawFail,modelVerified:sawPass,reviewToolObserved:review,unchangedTests,unchangedDocs,unchangedHead,status,tools:calls.map(c=>({name:c.name,failed:c.failed}))};
  console.log(JSON.stringify(result,null,2));
  assert.equal(after.status,0,"Independent regression must pass");
  assert.ok(unchangedTests && unchangedDocs && unchangedHead,"No test weakening, documentation change, or commit");
  assert.equal(status,"M pricing.mjs","Only the implementation file may change");
  assert.ok(sawFail && sawPass,"Model must reproduce and rerun the documented check itself");
  // A diff tool call is evidence of access, not proof of review quality.
  assert.ok(review || calls.some(c=>c.name==="bash"&&!c.failed&&/^\s*git\s+diff(?:\s|$)/.test(c.args?.command??"")),"Model must inspect changes");
  console.log("PASS: natural-language task, independent regression and observed verification; this does not certify other projects or models");
} finally { await pi.close(); }
