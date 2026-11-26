// Synthetic fixture acceptance: use the trusted test bytes from the harness,
// never the tests edited by the model. This is not an OS sandbox.
import { mkdtemp, writeFile, readFile, lstat, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

export async function verifyOriginalFixture(work, originalTests) {
  const impl = path.join(work, "pricing.mjs");
  const st = await lstat(impl);
  if (!st.isFile() || st.isSymbolicLink() || st.size > 65536) {
    throw Error("Fixture implementation must be a bounded regular file");
  }
  const candidate = await readFile(impl);
  const dir = await mkdtemp(path.join(tmpdir(), "astra-original-check-"));
  try {
    await writeFile(path.join(dir, "pricing.mjs"), candidate, {flag:"wx"});
    const testPath = path.join(dir, "pricing.test.mjs");
    await writeFile(testPath, originalTests, {flag:"wx"});
    // Do not pass inherited provider tokens or other user secrets to candidate code.
    const allow = new Set(["path","systemroot","windir","comspec","pathext","lang","lc_all"]);
    const env = Object.fromEntries(Object.entries(process.env).filter(([k])=>allow.has(k.toLowerCase())));
    Object.assign(env,{HOME:dir,USERPROFILE:dir,APPDATA:dir,LOCALAPPDATA:dir,TEMP:dir,TMP:dir,TMPDIR:dir});
    const run = spawnSync(process.execPath, ["--test","pricing.test.mjs"], {
      cwd:dir, env, encoding:"utf8", timeout:30000, maxBuffer:1024*1024, windowsHide:true
    });
    const originalsIntact = await readFile(testPath,"utf8").then(v=>v===originalTests,()=>false);
    const implementationIntact = await readFile(path.join(dir,"pricing.mjs")).then(v=>v.equals(candidate),()=>false);
    return {status:run.error||!originalsIntact||!implementationIntact?null:run.status,
      originalTestsIntact:originalsIntact, implementationIntact,
      output:String(run.stdout??"").slice(0,4000), error:String(run.stderr??"").slice(0,2000)};
  } finally { await rm(dir,{recursive:true,force:true,maxRetries:3}); }
}
