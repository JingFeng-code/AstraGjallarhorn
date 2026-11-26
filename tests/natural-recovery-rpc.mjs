// Real Pi + scripted provider. Verifies tool behavior, not real-model decisions.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { startPi, piCli } from "./lib/pi-rpc.mjs";
const id="20261126000000-abcd";
const pi=await startPi({
  cli:piCli(), extensions:["task-recovery.js"],
  cwdSetup: async (work,root)=>{
    const {mkdir,writeFile}=await import("node:fs/promises");
    const dir=path.join(root,"agent","tasks");
    await mkdir(dir,{recursive:true});
    await writeFile(path.join(dir,id+".json"),JSON.stringify({id,cwd:work,status:"interrupted",ownerPid:999999991,sessionId:"old",startedAt:"2026-11-26T00:00:00Z",prompt:"Fix synthetic pricing bug",tools:[{id:"old-call",name:"bash",brief:"node verify.mjs",state:"started",class:"mutating"}]}));
  },
  script:[{tools:[{name:"resume_interrupted_task",args:{}}]},{text:"not authorized"},{tools:[{name:"resume_interrupted_task",args:{}}]},{text:"inspect before proceeding"},{tools:[{name:"resume_interrupted_task",args:{}}]},{text:"no duplicate"}]
});
try {
  const record=async()=>JSON.parse(await readFile(path.join(pi.agent,"tasks",id+".json"),"utf8"));
  await pi.prompt("接續剛才中斷的工作");
  assert.equal((await record()).resumedBy,undefined);
  assert.match(JSON.stringify(pi.toolEnds().at(-1).result),/not authorized/i);
  pi.confirmAnswer=true;
  await pi.prompt("接續剛才中斷的工作");
  assert.match((await record()).resumedBy,/pid/);
  const result=JSON.stringify(pi.toolEnds().at(-1).result);
  assert.match(result,/Fix synthetic pricing bug/);
  assert.match(result,/OUTCOME UNKNOWN/);
  assert.match(result,/not new authorization/);
  await pi.prompt("再次接續");
  assert.match(JSON.stringify(pi.toolEnds().at(-1).result),/No matching unclaimed/);
  assert.equal(pi.toolEnds().length,3);
  console.log("PASS natural recovery: explicit confirmation, same-directory evidence, duplicate refusal");
} finally { await pi.close(); }
