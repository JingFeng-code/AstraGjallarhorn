import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { recognizeCheck,summarizeEvidence,worktreeFingerprint,registerEvidence } from "../extensions/verification-evidence.js";
test("recognizes bounded standalone checks, not arbitrary commands or shell chains",()=>{
  assert.equal(recognizeCheck("npm run lint").kind,"lint");
  assert.equal(recognizeCheck("dotnet test Notes.Tests.csproj --no-build").kind,"test");
  assert.equal(recognizeCheck("node --test pricing.test.mjs").kind,"test");
  for(const c of ["npm test || true","npm test; echo ok","echo PASS","npm run deploy","node --test ../outside.test.mjs","node --test\nfoo","dotnet test /tmp/a.csproj"])assert.equal(recognizeCheck(c),null,c);
});
const check=(result,before="b",after="b")=>new Map([["node --test",{kind:"test",id:"1",before,after,result}]]);
test("missing, failed, stale, and observed evidence never imply universal pass",()=>{
  assert.equal(summarizeEvidence("a","b",new Map()).status,"CHANGES_UNVERIFIED");
  assert.equal(summarizeEvidence("a","b",check("error")).status,"CHECK_ERROR_OBSERVED");
  assert.equal(summarizeEvidence("a","c",check("ok")).status,"STALE_OR_UNKNOWN");
  assert.equal(summarizeEvidence("a","b",check("ok","a","b")).status,"STALE_OR_UNKNOWN");
  assert.equal(summarizeEvidence("a","b",check("unknown")).status,"STALE_OR_UNKNOWN");
  assert.equal(summarizeEvidence("a",null,check("ok")).status,"UNKNOWN");
  assert.equal(summarizeEvidence("a","b",check("ok"),true).status,"UNKNOWN");
  assert.equal(summarizeEvidence("a","b",check("ok")).status,"CHECKS_OBSERVED_OK");
});
test("fingerprint changes with tracked, staged and untracked edits",async()=>{
  const d=await mkdtemp(path.join(tmpdir(),"astra-evidence-"));
  const git=(...args)=>execFileSync("git",args,{cwd:d});
  try{
    git("init","-q");await writeFile(path.join(d,"a.txt"),"a");
    git("add","a.txt");git("-c","user.name=Test","-c","user.email=test@example.invalid","commit","-qm","initial");
    const a=await worktreeFingerprint(d);assert.ok(a);
    await writeFile(path.join(d,"a.txt"),"b");const b=await worktreeFingerprint(d);assert.ok(b);assert.notEqual(a,b);
    git("add","a.txt");const c=await worktreeFingerprint(d);assert.ok(c);assert.notEqual(b,c);
    await writeFile(path.join(d,"new.txt"),"one");const e=await worktreeFingerprint(d);
    await writeFile(path.join(d,"new.txt"),"two");const f=await worktreeFingerprint(d);assert.ok(e&&f);assert.notEqual(e,f);
  }finally{await rm(d,{recursive:true,force:true});}
});
test("native observation sees error, later successful rerun, and stale changes",async()=>{
  const hooks=new Map();let tool;let state="a";const notices=[];
  const ctx={cwd:".",ui:{notify:(...a)=>notices.push(a)}};
  registerEvidence({on:(n,f)=>hooks.set(n,f),registerTool:t=>tool=t},{Object:x=>x},async()=>state);
  await hooks.get("agent_start")({},ctx);
  const run=async(id,isError)=>{
    await hooks.get("tool_execution_start")({toolName:"bash",toolCallId:id,args:{command:"node --test"}},ctx);
    await hooks.get("tool_execution_end")({toolCallId:id,isError},ctx);
  };
  const status=async()=>(await tool.execute("",{},null,null,ctx)).details.status;
  await run("1",true);assert.equal(await status(),"CHECK_ERROR_OBSERVED");
  state="b";await run("2",false);assert.equal(await status(),"CHECKS_OBSERVED_OK");
  state="c";assert.equal(await status(),"STALE_OR_UNKNOWN");
  await hooks.get("agent_end")({},ctx);assert.equal(notices.at(-1)[1],"warning");
  await hooks.get("agent_start")({},ctx);assert.equal(await status(),"NOT_OBSERVED");
});
