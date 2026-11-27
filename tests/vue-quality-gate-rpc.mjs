import assert from "node:assert/strict";
import {mkdtemp,rm,writeFile,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {startPi,piCli} from "./lib/pi-rpc.mjs";
import {vueFixture,implementation,testFile,check,policy,git,isVueCheck} from "./lib/vue-contract.mjs";
import {inspectCalls} from "./lib/autonomous-evidence.mjs";
const base=await mkdtemp(path.join(tmpdir(),"astra-vue-rpc-"));let pi;
try{
  const f=await vueFixture(base);
  pi=await startPi({cli:piCli(),baseDir:base,promptTimeoutMs:240000,isolatedHome:true,extensions:["quality-gate.js","verification-evidence.js","diff-review.js","command-guard.js"],env:{...f.childEnv,ASTRA_QUALITY_GATE:JSON.stringify(policy),ASTRA_GUARD_MODE:"strict"},cwdSetup:f.setup,
    script:[
      {tools:[{name:"edit",args:{path:implementation,oldText:f.brokenExpression,newText:f.originalExpression}}]},
      {tools:[{name:"bash",args:{command:check}}]},
      {tools:[{name:"edit",args:{path:testFile,oldText:'expect(normalizeTitle("  Draft   note  ")).toBe("Draft note");',newText:'expect(true).toBe(true);'}}]},
      {tools:[{name:"edit",args:{path:implementation,oldText:f.brokenExpression,newText:f.originalExpression}}]},
      {tools:[{name:"bash",args:{command:check}}]},
      {tools:[{name:"review_diff",args:{}}]},
      {tools:[{name:"quality_gate_status",args:{}}]},
      {text:"fixture"}
    ]});
  const before=await f.independentlyVerify(pi.work);assert.equal(before.status,1,before.output+before.error);assert.match(before.output+before.error,/ASTRA_VUE_TITLE_REGRESSION/);assert.match(before.output+before.error,/AssertionError/);
  const head=git(pi.work,"rev-parse","HEAD");
  await pi.prompt("業主反映儲存備註標題後仍有多餘空白，幫我查原因並修好。");
  const ends=pi.toolEnds();
  assert.match(JSON.stringify(ends[0].result),/original failing regression/);
  assert.equal(ends[1].isError,true,JSON.stringify(ends[1].result).slice(-16000));assert.match(JSON.stringify(ends[1].result),/ASTRA_VUE_TITLE_REGRESSION/);
  assert.match(JSON.stringify(ends[2].result),/outside approved/);
  assert.equal(ends[3].isError,false,JSON.stringify(ends[3].result).slice(-16000));
  // These are synthetic fixture outputs only; never print unrelated provider
  // requests or user environment. Diagnose the exact failing stage first.
  const finalCheck=ends[4];
  const finalText=(finalCheck.result?.content??[]).filter(c=>c.type==="text").map(c=>c.text).join("\n");
  console.log("Vue RPC final check (isError="+finalCheck.isError+"):\n"+finalText.slice(-20000));
  if(finalCheck.isError!==false){
    // Independent check uses the same repaired candidate with original files
    // but without the Pi tool layer. Distinguish fixture failure from RPC failure.
    try{
      const diagnostic=await f.independentlyVerify(pi.work);
      console.log("Independent diagnostic status="+diagnostic.status+"\n"+diagnostic.output+"\n"+diagnostic.error);
    }catch(e){console.log("Independent diagnostic blocked: "+String(e.message).slice(-6000));}
  }
  assert.equal(finalCheck.isError,false,"Final approved Vue check must succeed:\n"+finalText.slice(-16000));
  const obs=inspectCalls(pi.events,isVueCheck);assert.ok(obs.modelReproduced&&obs.modelVerified&&obs.reviewToolObserved);
  assert.equal(ends.find(e=>e.toolName==="quality_gate_status").result.details.status,"CHECK_AND_REVIEW_OBSERVED");
  assert.ok(pi.notices().some(n=>n.includes("Astra Quality Gate: CHECK_AND_REVIEW_OBSERVED")));
  const after=await f.independentlyVerify(pi.work);assert.equal(after.status,0,after.output+after.error);assert.match(after.output,/PASS: browser/);
  assert.ok(await f.unchanged(pi.work));assert.equal(git(pi.work,"rev-parse","HEAD"),head);
  assert.equal(git(pi.work,"status","--porcelain").trim(),"M "+implementation);
  // Prove a changed worktree test cannot determine independent results.
  await writeFile(path.join(pi.work,testFile),"// removed original test\n");
  const source=path.join(pi.work,implementation);
  await writeFile(source,(await readFile(source,"utf8")).replace(f.originalExpression,f.brokenExpression));
  assert.equal((await f.independentlyVerify(pi.work)).status,1);
  console.log("PASS: Vue original unit failure, protected tests, repair, lint/typecheck/build/Edge browser and independent offline verification");
}finally{if(pi)await pi.close();else await rm(base,{recursive:true,force:true,maxRetries:3});}
