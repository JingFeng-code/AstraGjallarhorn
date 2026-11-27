// Opt-in synthetic SQLite pilot with an installed local Ollama model.
import assert from "node:assert/strict";
import {readFile,writeFile,mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {startPi} from "../lib/pi-rpc.mjs";
import {sqlFixture,migration,check,policy,git,isSqlCheck} from "../lib/sql-contract.mjs";
import {inspectCalls,publicCalls} from "../lib/autonomous-evidence.mjs";
const [cli,model]=process.argv.slice(2);
if(!cli||!model||/cloud|remote/i.test(model))throw Error("Usage: node tests/real-model/sql-contract.mjs <pi cli.js> <installed local model>");
const tags=await fetch("http://127.0.0.1:11434/api/tags",{signal:AbortSignal.timeout(5000)});
assert.ok(tags.ok);
const installed=(await tags.json()).models.find(m=>m.name===model||m.name===model+":latest");
assert.ok(installed&&installed.size>0&&!installed.remote_model&&!installed.remote_host&&!/cloud|remote/i.test(installed.name),"Use an already downloaded local model; no pulls");
const repo=fileURLToPath(new URL("../../",import.meta.url));
const rules=await readFile(path.join(repo,"agent","AGENTS.md"),"utf8");
const f=await sqlFixture();
const pi=await startPi({cli,real:{model:installed.name},script:[],isolatedHome:true,
  env:{ASTRA_GUARD_MODE:"strict",ASTRA_QUALITY_GATE:JSON.stringify(policy)},
  extensions:["quality-gate.js","verification-evidence.js","diff-review.js","command-guard.js","checkpoint.js","retry-limit.js"],
  args:["--append-system-prompt",rules,...["architect","correct"].flatMap(n=>["--skill",path.join(repo,"agent","skills",n,"SKILL.md")]),"--tools","read,edit,bash,review_diff,verification_status,quality_gate_status"],
  cwdSetup:f.setup});
try{
  const before=await f.independentlyVerify(pi.work);
  assert.equal(before.status,1);assert.match(before.error,/title length constraint/);
  const head=git(pi.work,"rev-parse","HEAD");
  const timer=setTimeout(()=>pi.send("abort").catch(()=>{}),300000);
  try{await pi.prompt("業主反映備註標題超過欄位長度限制仍可寫入，幫我查原因並修好。");}finally{clearTimeout(timer);}
  const after=await f.independentlyVerify(pi.work);
  const obs=inspectCalls(pi.events,isSqlCheck);
  const gateObserved=pi.notices().some(n=>n.includes("Astra Quality Gate: CHECK_AND_REVIEW_OBSERVED"));
  const unchangedProtected=await f.unchanged(pi.work),unchangedHead=git(pi.work,"rev-parse","HEAD")===head,status=git(pi.work,"status","--porcelain").trim();
  const dir=await mkdtemp(path.join(tmpdir(),"astra-sql-model-trace-"));
  const starts=new Map(pi.events.filter(e=>e.type==="tool_execution_start").map(e=>[e.toolCallId,e]));
  const trace=pi.toolEnds().filter(e=>e.toolName==="bash").map(e=>({id:e.toolCallId,command:String(starts.get(e.toolCallId)?.args?.command??"").slice(0,2000),isError:e.isError??null,output:(e.result?.content??[]).filter(c=>c.type==="text").map(c=>c.text).join("\n").slice(0,4000)}));
  await writeFile(path.join(dir,"shell-trace.json"),JSON.stringify(trace,null,2));
  await writeFile(path.join(dir,"original-check.json"),JSON.stringify({before,after},null,2));
  await writeFile(path.join(dir,"fixture-diff.txt"),git(pi.work,"--no-pager","diff","--no-ext-diff","--no-textconv","HEAD","--",migration).slice(0,24000));
  console.log("Local-only evidence (inspect before sharing): "+dir);
  console.log(JSON.stringify({acceptance:"contract-constrained-sqlite",model:installed.name,gateObserved,independentBefore:before.status,independentAfter:after.status,modelReproduced:obs.modelReproduced,modelVerified:obs.modelVerified,reviewToolObserved:obs.reviewToolObserved,gitReviewObserved:obs.gitReviewObserved,unchangedProtected,unchangedHead,status,tools:publicCalls(obs.calls,isSqlCheck)},null,2));
  assert.equal(after.status,0,"Original SQLite contract must pass");assert.ok(unchangedProtected&&unchangedHead);
  assert.equal(status,"M "+migration);assert.ok(gateObserved&&obs.modelReproduced&&obs.modelVerified&&(obs.reviewToolObserved||obs.gitReviewObserved));
  console.log("PASS: contract-constrained SQLite migration repair; not Oracle/PostgreSQL/production certification");
}finally{await pi.close();}
