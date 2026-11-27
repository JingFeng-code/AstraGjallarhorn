import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {verifyOriginalFixture} from "./lib/original-fixture.mjs";

test("independent check uses original assertions even if model replaces every worktree test",async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),"astra-original-unit-"));
  try{
    const original="import assert from 'node:assert/strict'; import { total } from './pricing.mjs'; assert.equal(total(100,2,10),180);\n";
    await writeFile(path.join(dir,"pricing.mjs"),"export const total=(p,q,d)=>p*q-d;\n");
    await writeFile(path.join(dir,"pricing.test.mjs"),"// removed assertion\n");
    const failed=await verifyOriginalFixture(dir,original);
    assert.equal(failed.status,1);
    assert.equal(failed.originalTestsIntact,true);
    await writeFile(path.join(dir,"pricing.mjs"),"export const total=(p,q,d)=>p*q*(1-d/100);\n");
    const passed=await verifyOriginalFixture(dir,original);
    assert.equal(passed.status,0);
    assert.equal(await readFile(path.join(dir,"pricing.test.mjs"),"utf8"),"// removed assertion\n");
    assert.equal(passed.originalTestsIntact,true);
  }finally{await rm(dir,{recursive:true,force:true});}
});
