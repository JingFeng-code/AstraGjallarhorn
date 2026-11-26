import test from "node:test";
import assert from "node:assert/strict";
import {parseQualityPolicy,qualityDecision,registerQualityGate,allowedEdit} from "../extensions/quality-gate.js";
const p={version:1,check:"node --test pricing.test.mjs",failureMarker:"ERR_ASSERTION",writable:["pricing.mjs"]};
test("explicit narrow policy only; absent policy inactive; reject shell chains and test edits",()=>{
  assert.equal(parseQualityPolicy(undefined),null);
  assert.equal(parseQualityPolicy(JSON.stringify(p)).check,p.check);
  for(const q of [{...p,check:p.check+" || true"},{...p,writable:["../pricing.mjs"]},{...p,writable:["pricing.test.mjs"]}])assert.throws(()=>parseQualityPolicy(JSON.stringify(q)),/Invalid/);
});
test("gate blocks premature and unauthorized edits, arbitrary shell, and stale delivery evidence",async()=>{
  const hooks=new Map();let tool;let fp="a";
  const ctx={cwd:".",ui:{notify(){}}};
  registerQualityGate({on:(n,f)=>hooks.set(n,f),registerTool:t=>tool=t},{Object:x=>x},parseQualityPolicy(JSON.stringify(p)),async()=>fp,async(_root,input)=>input.path==="pricing.mjs");
  await hooks.get("agent_start")({},ctx);
  const call=async(id,toolName,input)=>hooks.get("tool_call")({toolCallId:id,toolName,input},ctx);
  const end=async(id,toolName,isError,result)=>hooks.get("tool_execution_end")({toolCallId:id,toolName,isError,result},ctx);
  const status=async()=>(await tool.execute("",{},null,null,ctx)).details.status;
  assert.match((await call("1","edit",{path:"pricing.mjs"})).reason,/failing regression/);
  assert.match((await call("2","bash",{command:"node -e 'x'"})).reason,/outside explicit/);
  assert.equal(await call("3","bash",{command:p.check}),undefined);
  assert.match((await call("4","edit",{path:"pricing.mjs"})).reason,/already running/);
  await end("3","bash",true,{content:[{type:"text",text:"ERR_ASSERTION"}]});
  assert.match((await call("5","edit",{path:"pricing.test.mjs"})).reason,/outside approved/);
  assert.equal(await call("6","edit",{path:"pricing.mjs"}),undefined);fp="b";await end("6","edit",false);
  assert.equal(await status(),"FINAL_CHECK_MISSING_OR_STALE");
  await call("7","bash",{command:p.check});await end("7","bash",false);
  assert.equal(await status(),"FINAL_REVIEW_MISSING_OR_STALE");
  await call("8","review_diff",{});await end("8","review_diff",false,{details:{unchanged:true}});
  assert.equal(await status(),"CHECK_AND_REVIEW_OBSERVED");
  fp="c";assert.equal(await status(),"FINAL_CHECK_MISSING_OR_STALE");
});
test("no gate pass from failed unrelated example or incomplete evidence",()=>{
  assert.equal(qualityDecision({reproduced:false,edits:1,last:"b",check:"b",review:"b"},"b"),"REPRODUCTION_NOT_OBSERVED");
  assert.equal(qualityDecision({reproduced:true,edits:1,last:"b",check:"b",review:"b",invalid:true},"b"),"UNKNOWN_OR_BLOCKED");
});

test("real filesystem scope accepts a cwd directory alias but rejects a file alias or hardlink",async()=>{
  const {mkdtemp,mkdir,writeFile,symlink,link,rm,realpath}=await import("node:fs/promises");
  const {tmpdir}=await import("node:os");
  const path=(await import("node:path")).default;
  const base=await mkdtemp(path.join(tmpdir(),"astra-gate-path-"));
  try{
    const root=path.join(base,"real"),alias=path.join(base,"alias");
    await mkdir(root);
    await writeFile(path.join(root,"pricing.mjs"),"fixture");
    await writeFile(path.join(root,"pricing.test.mjs"),"test");
    await symlink(root,alias,process.platform==="win32"?"junction":"dir");
    const policy=parseQualityPolicy(JSON.stringify(p));
    assert.equal(await allowedEdit(alias,{path:"pricing.mjs"},policy),true,"relative path via trusted cwd alias");
    assert.equal(await allowedEdit(alias,{path:path.join(root,"pricing.mjs")},policy),true,"absolute path via original root spelling");
    assert.equal(await allowedEdit(alias,{path:path.join(await realpath(root),"pricing.mjs")},policy),true,"absolute canonical path");
    const outside=path.join(base,"outside");
    await mkdir(outside);
    await writeFile(path.join(outside,"pricing.mjs"),"different file");
    const outsideAlias=path.join(base,"outside-alias");
    await symlink(outside,outsideAlias,process.platform==="win32"?"junction":"dir");
    assert.equal(await allowedEdit(alias,{path:path.join(outsideAlias,"pricing.mjs")},policy),false,"same basename in different directory");
    assert.equal(await allowedEdit(alias,{path:"pricing.test.mjs"},policy),false);
    assert.equal(await allowedEdit(alias,{path:"../real/pricing.test.mjs"},policy),false);
    await link(path.join(root,"pricing.mjs"),path.join(root,"other.mjs"));
    assert.equal(await allowedEdit(alias,{path:"pricing.mjs"},policy),false);
  }finally{await rm(base,{recursive:true,force:true,maxRetries:3});}
});
