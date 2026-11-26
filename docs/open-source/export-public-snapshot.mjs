// Private preparation tool; NOT part of the public distribution.
// Usage: node docs/open-source/export-public-snapshot.mjs <exact preparation commit>
// Produces a new local temp directory only. Never initializes Git, changes
// remotes, publishes, installs dependencies, runs CI, or changes the source.
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir,mkdtemp,writeFile,readFile,readdir,lstat,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
const commit=process.argv[2];
assert.match(commit??"",/^[a-f0-9]{40}$/,"Specify a reviewed exact preparation commit");
const git=(...args)=>execFileSync("git",["--no-pager",...args],{maxBuffer:16*1024*1024,timeout:30000,windowsHide:true,env:{...process.env,GIT_OPTIONAL_LOCKS:"0"}});
const root=git("rev-parse","--show-toplevel").toString().trim();
assert.equal(git("-C",root,"rev-parse",commit+"^{commit}").toString().trim(),commit);
const pathOk=p=>typeof p==="string"&&p.length<=240&&p.split("/").every(s=>/^[A-Za-z0-9._-]+$/.test(s)&&![".","..",".git"].includes(s.toLowerCase())&&!/[. ]$/.test(s)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s));
const manifestPath="docs/open-source/public-export-manifest.json";
function getBlob(ref,p,sha){
  assert.ok(pathOk(p),"Unsafe manifest path");
  const entry=git("-C",root,"ls-tree",ref,"--",p).toString().trimEnd();
  const m=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(entry);
  assert.ok(m&&m[3]===p,"Expected exact regular tracked file: "+p);
  if(sha)assert.equal(m[2],sha,"Source blob changed: "+p);
  const bytes=git("-C",root,"cat-file","blob",m[2]);
  const digest=createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex");
  assert.equal(digest,m[2],"Git blob digest mismatch");
  assert.ok(bytes.length<=2*1024*1024,"Unexpected large blob");
  return bytes;
}
const manifest=JSON.parse(getBlob(commit,manifestPath).toString("utf8"));
assert.equal(manifest.schemaVersion,1);
assert.equal(manifest.status,"PRIVATE_REVIEW_CANDIDATE");
assert.match(manifest.sourceCommit,/^[a-f0-9]{40}$/);
assert.equal(manifest.copy.length,123);
assert.equal(manifest.replace.length,9);
const records=[];
const targets=new Set();
const forbidden=p=>/^(?:CONTINUE\.md|docs\/(?:open-source(?:\/|-readiness)|verification\/evidence)|tests\/real-model\/(?:formal|handoff-e2e)\.mjs)(?:\/|$)/i.test(p)||/(?:^|\/)(?:auth\.json|credentials\.json|settings\.json|keybindings\.json|\.env(?:\..*)?|\.npmrc|\.netrc|\.git-credentials|sessions|tasks|handoffs|checkpoints|node_modules)(?:\/|$)/i.test(p);
function add(p,bytes){
  assert.ok(pathOk(p)&&!forbidden(p),"Forbidden public path: "+p);
  const key=p.toLowerCase();assert.ok(!targets.has(key),"Duplicate public path: "+p);targets.add(key);
  records.push({path:p,bytes,sha256:createHash("sha256").update(bytes).digest("hex")});
}
for(const f of manifest.copy)add(f.path,getBlob(manifest.sourceCommit,f.path,f.sha));
for(const f of manifest.replace){assert.ok(f.template.startsWith("docs/open-source/templates/"));add(f.path,getBlob(commit,f.template));}
assert.equal(records.length,132);
for(const f of ["README.md","README.en.md","LICENSE","SECURITY.md","THIRD_PARTY_NOTICES.md",".github/workflows/verification.yml"])assert.ok(targets.has(f.toLowerCase()));
const base=await mkdtemp(path.join(tmpdir(),"astra-public-review-"));
const out=path.join(base,"snapshot");
try{
  await mkdir(out);
  for(const f of records){
    const dest=path.join(out,...f.path.split("/"));
    await mkdir(path.dirname(dest),{recursive:true});
    await writeFile(dest,f.bytes,{flag:"wx"});
    assert.equal(createHash("sha256").update(await readFile(dest)).digest("hex"),f.sha256);
  }
  async function walk(dir,prefix=""){
    const files=[];
    for(const name of await readdir(dir)){
      const p=path.join(dir,name),rel=prefix+name,st=await lstat(p);
      assert.ok(!st.isSymbolicLink());
      if(st.isDirectory())files.push(...await walk(p,rel+"/"));
      else {assert.ok(st.isFile());files.push(rel);}
    }
    return files;
  }
  assert.deepEqual((await walk(out)).sort(),records.map(f=>f.path).sort());
  const report={status:"LOCAL_REVIEW_ONLY_NOT_PUBLISHED",preparationCommit:commit,sourceCommit:manifest.sourceCommit,count:records.length,files:records.map(({path,sha256})=>({path,sha256})).sort((a,b)=>a.path.localeCompare(b.path))};
  await writeFile(path.join(base,"private-review-manifest.json"),JSON.stringify(report,null,2)+"\n",{flag:"wx"});
  console.log(JSON.stringify({status:report.status,files:report.count,snapshot:out,privateReviewManifest:path.join(base,"private-review-manifest.json")},null,2));
  console.log("Review the exact files and first-party rights; never publish the parent directory or private review manifest.");
}catch(e){await rm(base,{recursive:true,force:true,maxRetries:3});throw e;}
