// Phase 4D-1: real Vue browser -> HTTP -> ASP.NET Core -> service -> SQLite.
// Trusted harness, no model, no new dependency versions, no live DB.
import assert from "node:assert/strict";
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm,realpath} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {spawn,spawnSync} from "node:child_process";
import {once} from "node:events";
import {DatabaseSync} from "node:sqlite";
import {vueFixture} from "./lib/vue-contract.mjs";
const repo=fileURLToPath(new URL("../",import.meta.url));
const base=await mkdtemp(path.join(tmpdir(),"astra-cross-layer-"));
const work=path.join(base,"work"),web=path.join(work,"examples/vue"),api=path.join(work,"examples/fullstack/Api");
const project=path.join(api,"Notes.Api.csproj"),service=path.join(api,"NoteService.cs");
const sdk="10.0.401",raw="  Draft   note  ",expected="Draft note";
const good='Regex.Replace(raw.Trim(), @"\\s+", " ")',bad="raw.Trim()";
const run=(cmd,args,cwd,env,timeout=120000)=>{
  const r=spawnSync(cmd,args,{cwd,env,encoding:"utf8",timeout,maxBuffer:4*1024*1024,windowsHide:true});
  const output=String(r.stdout??"")+"\n"+String(r.stderr??"");
  if(r.error||r.status!==0)throw Error("BLOCKED_OR_FAILED: "+cmd+" "+args[0]+"\n"+output.slice(-8000)+(r.error?"\n"+r.error.message:""));
  return output;
};
async function ready(child){
  let output="";
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>finish(Error("API startup timeout\n"+output.slice(-4000))),20000);
    const finish=(err,url)=>{
      clearTimeout(timer);
      child.stdout.off("data",data);child.stderr.off("data",data);
      child.off("error",failed);child.off("exit",exited);
      // Drain subsequent logs rather than blocking the child on a full pipe.
      child.stdout.resume();child.stderr.resume();
      if(err)reject(err);else resolve(url);
    };
    const data=chunk=>{
      output=(output+String(chunk)).slice(-16000);
      const match=/ASTRA_READY (http:\/\/127\.0\.0\.1:\d+)\r?\n/.exec(output);
      if(match)finish(null,match[1]);
    };
    const failed=e=>finish(e);
    const exited=code=>finish(Error("API exited before readiness ("+code+")\n"+output.slice(-4000)));
    child.stdout.on("data",data);child.stderr.on("data",data);
    child.once("error",failed);child.once("exit",exited);
  });
}
async function stop(child){
  if(child&&child.pid&&child.exitCode===null&&child.signalCode===null){
    const exit=once(child,"exit");
    child.kill();
    await exit;
  }
}
try{
  const f=await vueFixture(base);
  await f.setup(work);
  // The previous Vue fixture injects a different defect. Restore original
  // normalization and replace only the temporary UI with the cross-layer UI.
  await copyFile(path.join(repo,"examples/vue/src/title.ts"),path.join(web,"src/title.ts"));
  await copyFile(path.join(repo,"examples/fullstack/web/NoteEditor.vue"),path.join(web,"src/NoteEditor.vue"));
  await mkdir(api,{recursive:true});
  for(const name of ["Notes.Api.csproj","Program.cs","NoteService.cs","NoteRepository.cs","schema.sql","db.mjs"])
    await copyFile(path.join(repo,"examples/fullstack/Api",name),path.join(api,name));
  const original=await readFile(service,"utf8");
  assert.ok(original.includes(good));
  await writeFile(path.join(work,"global.json"),JSON.stringify({sdk:{version:sdk,rollForward:"disable"}}));
  const config=path.join(base,"NuGet.Config"),feed=path.join(base,"empty-feed"),home=path.join(base,"tool-home");
  await mkdir(feed,{recursive:true});await mkdir(home,{recursive:true});
  await writeFile(config,'<configuration><packageSources><clear /></packageSources><fallbackPackageFolders><clear /></fallbackPackageFolders></configuration>');
  const allowed=new Set(["path","systemroot","windir","comspec","pathext","programfiles","programfiles(x86)","programw6432","os","systemdrive","dotnet_root","dotnet_root(x86)","lang","lc_all"]);
  const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>allowed.has(k.toLowerCase()))),
    ...f.childEnv,HOME:home,USERPROFILE:home,APPDATA:home,LOCALAPPDATA:home,TEMP:base,TMP:base,TMPDIR:base,
    DOTNET_CLI_HOME:home,DOTNET_CLI_TELEMETRY_OPTOUT:"1",DOTNET_NOLOGO:"1",DOTNET_SKIP_FIRST_TIME_EXPERIENCE:"1",
    DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE:"true",DOTNET_CLI_USE_MSBUILD_SERVER:"0",MSBUILDDISABLENODEREUSE:"1",
    NUGET_PACKAGES:path.join(base,"packages"),NUGET_HTTP_CACHE_PATH:path.join(base,"nuget-http")};
  assert.equal(run("dotnet",["--version"],work,env).trim(),sdk);
  run("dotnet",["restore",project,"--source",feed,"--configfile",config,"-p:NuGetAudit=false"],work,env);
  const npm=f.childEnv.ASTRA_VUE_NPM_CLI;
  for(const args of [["test"],["run","lint"],["run","typecheck"],["run","build"]]){
    run(process.execPath,[npm,"--offline","--ignore-scripts","--no-audit","--no-fund",...args],web,env);
    console.log("PASS frontend: "+args.join(" "));
  }
  const require=createRequire(path.join(web,"package.json"));
  const {chromium}=require("@playwright/test");
  const output=path.join(base,"api-build");
  const edgeEnv={...JSON.parse(f.childEnv.ASTRA_VUE_EDGE_ENV),TEMP:f.childEnv.ASTRA_VUE_BROWSER_TMP,TMP:f.childEnv.ASTRA_VUE_BROWSER_TMP};
  async function scenario(label){
    run("dotnet",["build",project,"--no-restore","-o",output],work,env);
    const db=path.join(base,label+".sqlite");
    const child=spawn("dotnet",[path.join(output,"Notes.Api.dll")],{cwd:api,env:{...env,ASTRA_DB:db,ASTRA_DB_ADAPTER:path.join(api,"db.mjs"),ASTRA_NODE:process.execPath,ASTRA_WEB_ROOT:path.join(web,"dist")},stdio:["ignore","pipe","pipe"],windowsHide:true});
    let browser;
    try{
      const url=await ready(child);
      browser=await chromium.launch({channel:"msedge",env:edgeEnv,timeout:20000});
      const context=await browser.newContext();
      await context.route("**/*",route=>new URL(route.request().url()).origin===url?route.continue():route.abort());
      const page=await context.newPage(),errors=[];
      page.on("pageerror",e=>errors.push(e.message));
      page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
      await page.goto(url,{timeout:15000});
      await page.getByLabel("Title").fill(raw);
      const [post,get]=await Promise.all([
        page.waitForResponse(r=>r.url()===url+"/api/notes"&&r.request().method()==="POST",{timeout:15000}),
        page.waitForResponse(r=>r.url().startsWith(url+"/api/notes/")&&r.request().method()==="GET",{timeout:15000}),
        page.getByRole("button",{name:"Save"}).click()
      ]);
      assert.equal(post.status(),201);assert.equal(get.status(),200);
      assert.deepEqual(post.request().postDataJSON(),{title:raw});
      const saved=await post.json(),loaded=await get.json();
      assert.equal(saved.id,loaded.id);assert.equal(get.url(),url+"/api/notes/"+saved.id);
      await page.getByRole("button",{name:"Save"}).waitFor({state:"visible"});
      await page.waitForFunction(()=>document.querySelector("button")?.disabled===false,undefined,{timeout:10000});
      assert.deepEqual(errors,[]);assert.equal(await page.getByRole("alert").count(),0);
      const ui=await page.getByRole("status").textContent();
      // Actual independent DB read, not the API's returned data.
      const sql=new DatabaseSync(db,{readOnly:true});
      let persisted,count;
      try{
        persisted=sql.prepare("SELECT title FROM notes WHERE id = ?").get(saved.id)?.title;
        count=sql.prepare("SELECT COUNT(*) AS count FROM notes").get().count;
      }finally{sql.close();}
      assert.equal(count,1);
      const rejected=await fetch(url+"/api/notes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:"x".repeat(41)}),signal:AbortSignal.timeout(15000)});
      assert.equal(rejected.status,400);
      const checkDb=new DatabaseSync(db,{readOnly:true});
      try{assert.equal(checkDb.prepare("SELECT COUNT(*) AS count FROM notes").get().count,1);}
      finally{checkDb.close();}
      const result={requestTitle:raw,postStatus:201,getStatus:200,apiTitle:saved.title,readbackTitle:loaded.title,dbTitle:persisted,uiTitle:ui};
      console.log(label+": "+JSON.stringify(result));
      return result;
    }finally{try{if(browser)await browser.close();}finally{await stop(child);}}
  }
  const correct=r=>assert.deepEqual([r.apiTitle,r.readbackTitle,r.dbTitle,r.uiTitle],Array(4).fill(expected),"cross-layer title contract");
  correct(await scenario("baseline"));
  await writeFile(service,original.replace(good,bad));
  const broken=await scenario("fault");
  // Require a real data-flow failure, not a startup/test-infrastructure error.
  assert.deepEqual([broken.apiTitle,broken.readbackTitle,broken.dbTitle,broken.uiTitle],Array(4).fill("Draft   note"));
  assert.throws(()=>correct(broken),/cross-layer title contract/);
  await writeFile(service,original);
  correct(await scenario("restored"));
  console.log("PASS: full-stack real browser/HTTP/ASP.NET Core/SQLite fault injection 0 -> 1 -> 0; no EF Core/model certification");
}finally{await rm(base,{recursive:true,force:true,maxRetries:5,retryDelay:300});}
