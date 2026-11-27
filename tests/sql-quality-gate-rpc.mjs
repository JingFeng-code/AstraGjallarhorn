import assert from "node:assert/strict";
import {startPi,piCli} from "./lib/pi-rpc.mjs";
import {sqlFixture,migration,verifier,check,policy,git,isSqlCheck} from "./lib/sql-contract.mjs";
import {inspectCalls} from "./lib/autonomous-evidence.mjs";
const f=await sqlFixture();
const pi=await startPi({cli:piCli(),extensions:["quality-gate.js","verification-evidence.js","diff-review.js","command-guard.js"],env:{ASTRA_QUALITY_GATE:JSON.stringify(policy)},cwdSetup:f.setup,
  script:[
    {tools:[{name:"edit",args:{path:migration,oldText:f.wrong,newText:f.correct}}]},
    {tools:[{name:"bash",args:{command:check}}]},
    {tools:[{name:"edit",args:{path:verifier,oldText:"database.close();",newText:""}}]},
    {tools:[{name:"edit",args:{path:migration,oldText:f.wrong,newText:f.correct}}]},
    {tools:[{name:"bash",args:{command:check}}]},
    {tools:[{name:"review_diff",args:{}}]},
    {tools:[{name:"quality_gate_status",args:{}}]},
    {text:"fixture"}
  ]});
try{
  const before=await f.independentlyVerify(pi.work);assert.equal(before.status,1);
  const head=git(pi.work,"rev-parse","HEAD");
  await pi.prompt("業主反映備註標題超過欄位長度限制仍可寫入，幫我查原因並修好。");
  const ends=pi.toolEnds();
  assert.match(JSON.stringify(ends[0].result),/original failing regression/);
  assert.equal(ends[1].isError,true);assert.match(JSON.stringify(ends[1].result),/title length constraint/);
  assert.match(JSON.stringify(ends[2].result),/outside approved/);
  assert.equal(ends[3].isError,false);
  assert.equal(ends[4].isError,false);
  const evidence=inspectCalls(pi.events,isSqlCheck);
  assert.ok(evidence.modelReproduced&&evidence.modelVerified&&evidence.reviewToolObserved);
  assert.equal(ends.find(e=>e.toolName==="quality_gate_status").result.details.status,"CHECK_AND_REVIEW_OBSERVED");
  assert.ok(pi.notices().some(n=>n.includes("Astra Quality Gate: CHECK_AND_REVIEW_OBSERVED")));
  assert.equal((await f.independentlyVerify(pi.work)).status,0);
  assert.ok(await f.unchanged(pi.work));assert.equal(git(pi.work,"rev-parse","HEAD"),head);
  assert.equal(git(pi.work,"status","--porcelain").trim(),"M "+migration);
  console.log("PASS: actual SQLite migration failure, protected verifier, source repair, final check/review and independent original verifier");
}finally{await pi.close();}
