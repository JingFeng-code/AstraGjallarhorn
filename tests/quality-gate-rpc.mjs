import assert from "node:assert/strict";
import {writeFile,readFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import path from "node:path";
import {startPi,piCli} from "./lib/pi-rpc.mjs";
const check="node --test pricing.test.mjs";
const tests="import assert from 'node:assert/strict'; import {total} from './pricing.mjs'; assert.equal(total(100,2,10),180);\n";
const pi=await startPi({cli:piCli(),extensions:["quality-gate.js","verification-evidence.js","diff-review.js","command-guard.js"],env:{ASTRA_QUALITY_GATE:JSON.stringify({version:1,check,failureMarker:"ERR_ASSERTION",writable:["pricing.mjs"]})},
  cwdSetup:async work=>{
    await writeFile(path.join(work,"pricing.mjs"),"export const total=(p,q,d)=>p*q-d;\n");
    await writeFile(path.join(work,"pricing.test.mjs"),tests);
    const git=(...args)=>execFileSync("git",args,{cwd:work});
    git("init","-q");git("add","-A");git("-c","user.name=Test","-c","user.email=test@example.invalid","commit","-qm","fixture");
  },
  script:[
    {tools:[{name:"edit",args:{path:"pricing.mjs",oldText:"p*q-d",newText:"p*q*(1-d/100)"}}]},
    {tools:[{name:"bash",args:{command:"node -e 'console.log(1)'"}}]},
    {tools:[{name:"bash",args:{command:check}}]},
    {tools:[{name:"edit",args:{path:"pricing.test.mjs",oldText:"180",newText:"190"}}]},
    {tools:[{name:"edit",args:{path:"pricing.mjs",oldText:"p*q-d",newText:"p*q*(1-d/100)"}}]},
    {tools:[{name:"quality_gate_status",args:{}}]},
    {tools:[{name:"bash",args:{command:check}}]},
    {tools:[{name:"quality_gate_status",args:{}}]},
    {tools:[{name:"review_diff",args:{}}]},
    {tools:[{name:"quality_gate_status",args:{}}]},
    {text:"fixture"}
  ]});
try{
  await pi.prompt("修正訂單折扣錯誤");
  const ends=pi.toolEnds();
  assert.match(JSON.stringify(ends[0].result),/original failing regression/);
  assert.match(JSON.stringify(ends[1].result),/outside explicit contract/);
  assert.equal(ends[2].isError,true);
  assert.match(JSON.stringify(ends[3].result),/outside approved/);
  assert.equal(ends[4].isError,false);
  assert.equal(await readFile(path.join(pi.work,"pricing.test.mjs"),"utf8"),tests);
  assert.deepEqual(ends.filter(e=>e.toolName==="quality_gate_status").map(e=>e.result.details.status),["FINAL_CHECK_MISSING_OR_STALE","FINAL_REVIEW_MISSING_OR_STALE","CHECK_AND_REVIEW_OBSERVED"]);
  assert.ok(pi.notices().some(n=>n.includes("Astra Quality Gate: CHECK_AND_REVIEW_OBSERVED")));
  console.log("PASS explicit quality gate: native pre-edit denial, original failed check, unauthorized test denial, edit, final check and review");
}finally{await pi.close();}
