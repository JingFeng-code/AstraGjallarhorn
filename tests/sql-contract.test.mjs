import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {sqlFixture,migration,verifier} from "./lib/sql-contract.mjs";
test("original SQLite verifier rejects actual 41-character regression even if worktree verifier is replaced",async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),"astra-sql-fixture-"));
  try{
    const f=await sqlFixture();await f.setup(dir);
    const before=await f.independentlyVerify(dir);
    assert.equal(before.status,1);assert.match(before.error,/title length constraint/);
    await writeFile(path.join(dir,verifier),"console.log('fake pass');\n");
    assert.equal((await f.independentlyVerify(dir)).status,1);
    const file=path.join(dir,migration);
    await writeFile(file,(await readFile(file,"utf8")).replace(f.wrong,f.correct));
    assert.equal((await f.independentlyVerify(dir)).status,0);
    assert.equal(await f.unchanged(dir),false);
  }finally{await rm(dir,{recursive:true,force:true,maxRetries:3});}
});
