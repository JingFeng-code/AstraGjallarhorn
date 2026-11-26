import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { startPi,piCli } from "./lib/pi-rpc.mjs";
const git=(cwd,...args)=>execFileSync("git",args,{cwd});
const pi=await startPi({
  cli:piCli(),extensions:["verification-evidence.js"],
  cwdSetup:async work=>{
    git(work,"init","-q");
    await writeFile(path.join(work,"value.txt"),"wrong\n");
    await writeFile(path.join(work,"check.test.mjs"),"import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs'; assert.equal(readFileSync('value.txt','utf8').trim(),'right');\n");
    git(work,"add","-A");git(work,"-c","user.name=Test","-c","user.email=test@example.invalid","commit","-qm","initial");
  },
  script:[
    {tools:[{name:"bash",args:{command:"node --test check.test.mjs"}}]},
    {tools:[{name:"verification_status",args:{}}]},
    {tools:[{name:"edit",args:{path:"value.txt",oldText:"wrong",newText:"right"}}]},
    {tools:[{name:"bash",args:{command:"node --test check.test.mjs"}}]},
    {tools:[{name:"verification_status",args:{}}]},
    {tools:[{name:"edit",args:{path:"value.txt",oldText:"right",newText:"changed"}}]},
    {tools:[{name:"verification_status",args:{}}]},
    {text:"fixture"}
  ]
});
try{
  await pi.prompt("修正合成測試案例");
  const results=pi.toolEnds().filter(e=>e.toolName==="verification_status").map(e=>e.result.details.status);
  assert.deepEqual(results,["CHECK_ERROR_OBSERVED","CHECKS_OBSERVED_OK","STALE_OR_UNKNOWN"]);
  assert.ok(pi.notices().some(n=>n.includes("STALE_OR_UNKNOWN")));
  console.log("PASS: actual Pi bash failure, success, and stale evidence after edit");
}finally{await pi.close();}
