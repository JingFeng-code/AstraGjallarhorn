import test from "node:test";
import assert from "node:assert/strict";
import {isFixtureCheck,inspectCalls,publicCalls} from "./lib/autonomous-evidence.mjs";
const start=(id,toolName,args={})=>({type:"tool_execution_start",toolCallId:id,toolName,args});
const end=(id,toolName,isError)=>({type:"tool_execution_end",toolCallId:id,toolName,isError});
const call=(id,name,args={},error=false)=>[start(id,name,args),end(id,name,error)];
test("recognizes standalone fixture checks, not shell chains or unrelated files",()=>{
  for(const cmd of ["node --test","node --test pricing.test.mjs","node --test ./pricing.test.mjs","node --test 'pricing.test.mjs'","node --test \"./pricing.test.mjs\""])assert.ok(isFixtureCheck(cmd),cmd);
  for(const cmd of ["node --test other.mjs","node --test pricing.test.mjs || true","node --test pricing.test.mjs; echo ok","node --test\npricing.test.mjs","node --test --test-name-pattern=x"])assert.equal(isFixtureCheck(cmd),false,cmd);
});
test("must observe real failed check before edit, passing check and review after last edit",()=>{
  const a=[...call("1","bash",{command:"node --test"},true),...call("2","edit"),...call("3","bash",{command:"node --test ./pricing.test.mjs"}),...call("4","review_diff")];
  const good=inspectCalls(a);
  assert.ok(good.modelReproduced&&good.modelVerified&&good.reviewToolObserved);
  const stale=inspectCalls([...a,...call("5","edit")]);
  assert.equal(stale.modelVerified,false);assert.equal(stale.reviewToolObserved,false);
  const before=inspectCalls([...call("1","review_diff"),...call("2","edit"),...call("3","bash",{command:"node --test"})]);
  assert.equal(before.modelReproduced,false);assert.equal(before.reviewToolObserved,false);
});
test("overlapping edits/checks and missing error flags do not establish ordering or pass",()=>{
  const overlap=inspectCalls([start("1","bash",{command:"node --test"}),start("2","edit"),end("1","bash",true),end("2","edit",false),start("3","edit"),start("4","bash",{command:"node --test"}),end("3","edit",false),end("4","bash",false)]);
  assert.equal(overlap.modelReproduced,false);assert.equal(overlap.modelVerified,false);
  const unknown=inspectCalls([...call("1","bash",{command:"node --test"},true),...call("2","edit"),start("3","bash",{command:"node --test"}),end("3","bash",undefined)]);
  assert.equal(unknown.modelVerified,false);
});
test("public diagnostics do not disclose unrecognized shell arguments",()=>{
  const c=inspectCalls(call("1","bash",{command:"echo private-value"}));
  assert.equal(publicCalls(c.calls)[0].recognizedCheck,false);
  assert.doesNotMatch(JSON.stringify(publicCalls(c.calls)),/private-value/);
});
