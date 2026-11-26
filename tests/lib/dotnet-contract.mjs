// Fixed synthetic .NET fixture. Only an already cached, locked package set is
// copied to a temporary offline feed; never download dependencies locally.
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir,mkdtemp,rm,lstat,copyFile} from "node:fs/promises";
import {execFileSync,spawnSync} from "node:child_process";
import {homedir,tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
export const implementation="examples/dotnet/Storage/NoteStore.cs";
export const project="examples/dotnet/Notes.Tests.csproj";
export const testFile="examples/dotnet/NoteTests.cs";
export const check="dotnet test "+project+" --no-restore";
export const isDotnetCheck=c=>typeof c==="string"&&!/[\r\n]/.test(c)&&c.trim()===check;
export const policy={version:3,kind:"dotnet-note-store",check,failureMarker:"SavedNoteCanBeLoaded",writable:[implementation]};
const root=fileURLToPath(new URL("../../",import.meta.url));
const names=[implementation,project,testFile,"examples/dotnet/Domain/Note.cs","examples/dotnet/.gitignore","examples/dotnet/.editorconfig","examples/dotnet/packages.lock.json","examples/dotnet/README.md"];
export const git=(cwd,...args)=>execFileSync("git",args,{cwd,encoding:"utf8",timeout:30000});
const sdk="10.0.401";
const originalExpression="notes[id];",brokenExpression='notes[id] with { Title = "wrong" };';
function dotnetEnv(base){
  const allowed=new Set(["path","systemroot","windir","comspec","pathext","programfiles","programfiles(x86)","programw6432","os","systemdrive","dotnet_root","dotnet_root(x86)","lang","lc_all"]);
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>allowed.has(k.toLowerCase())));
  const home=path.join(base,"dotnet-home");
  return {...env,HOME:home,USERPROFILE:home,APPDATA:home,LOCALAPPDATA:home,TEMP:base,TMP:base,TMPDIR:base,
    DOTNET_CLI_HOME:home,DOTNET_CLI_TELEMETRY_OPTOUT:"1",DOTNET_NOLOGO:"1",DOTNET_SKIP_FIRST_TIME_EXPERIENCE:"1",
    DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE:"true",DOTNET_ADD_GLOBAL_TOOLS_TO_PATH:"false",DOTNET_CLI_UI_LANGUAGE:"en-US",VSLANG:"1033",
    DOTNET_CLI_USE_MSBUILD_SERVER:"0",MSBUILDDISABLENODEREUSE:"1",UseSharedCompilation:"false",
    NUGET_PACKAGES:path.join(base,"packages"),NUGET_HTTP_CACHE_PATH:path.join(base,"nuget-http"),NUGET_PLUGINS_CACHE_PATH:path.join(base,"nuget-plugins")};
}
function run(args,cwd,env,timeout=120000){
  const result=spawnSync("dotnet",args,{cwd,env,encoding:"utf8",timeout,maxBuffer:4*1024*1024,windowsHide:true});
  return {status:result.error?null:result.status,output:String(result.stdout??""),error:String(result.stderr??"")+(result.error?"\n"+result.error.message:"")};
}
function requireOk(result,label){
  assert.equal(result.status,0,label+"\n"+(result.output+"\n"+result.error).slice(-6000));
}
export function cachedPackageNames(lock){
  const packages=lock?.dependencies?.["net10.0"];
  if(!packages||typeof packages!=="object"||!Object.keys(packages).length)throw Error("Missing locked net10.0 packages");
  return Object.entries(packages).map(([name,p])=>{
    if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)||typeof p.resolved!=="string"||!/^[0-9][a-zA-Z0-9.+-]*$/.test(p.resolved))throw Error("Invalid locked package path");
    const id=name.toLowerCase(),version=p.resolved.toLowerCase();
    return {id,version,file:id+"."+version+".nupkg"};
  });
}
export async function dotnetFixture(base){
  const originals=Object.fromEntries(await Promise.all(names.map(async f=>[f,await readFile(path.join(root,f),"utf8")])));
  const original=originals[implementation];assert.ok(original.includes(originalExpression)&&!original.includes(brokenExpression));
  originals["README.md"]="# Notes maintenance incident\nA saved note must be loaded with its original title. Run "+check+" before and after repair. Only "+implementation+" may change; keep original xUnit tests and architecture constraints. Dependencies have been restored offline by the harness; do not restore or install packages.\n";
  originals["global.json"]=JSON.stringify({sdk:{version:sdk,rollForward:"disable"}})+"\n";
  const feed=path.join(base,"feed"),config=path.join(base,"NuGet.Config");
  await mkdir(feed,{recursive:true});
  await writeFile(config,'<?xml version="1.0" encoding="utf-8"?><configuration><packageSources><clear /></packageSources><fallbackPackageFolders><clear /></fallbackPackageFolders><disabledPackageSources><clear /></disabledPackageSources></configuration>\n');
  // Explicit path only, or default global packages location. No NuGet config or
  // credentials read from the original machine.
  const cache=process.env.NUGET_PACKAGES||path.join(homedir(),".nuget","packages");
  for(const p of cachedPackageNames(JSON.parse(originals["examples/dotnet/packages.lock.json"]))){
    const file=path.join(cache,p.id,p.version,p.file);
    const st=await lstat(file).catch(()=>null);
    if(!st?.isFile()||st.isSymbolicLink())throw Error("BLOCKED_OFFLINE_CACHE: missing locked "+p.id+" "+p.version+"; no package download attempted");
    await copyFile(file,path.join(feed,p.file));
  }
  const env=dotnetEnv(base);
  await mkdir(env.DOTNET_CLI_HOME,{recursive:true});
  const version=run(["--version"],base,env,30000);
  requireOk(version,"Existing .NET SDK required");
  // Validate the exact SDK in the fixture after creating global.json.
  async function writeProject(work,candidate){
    for(const [file,content] of Object.entries(originals)){
      await mkdir(path.dirname(path.join(work,file)),{recursive:true});
      await writeFile(path.join(work,file),file===implementation?candidate:content);
    }
  }
  function restore(work,localEnv){
    const v=run(["--version"],work,localEnv,30000);
    requireOk(v,"Pinned .NET SDK "+sdk+" required; no upgrade");
    assert.equal(v.output.trim(),sdk,"Pinned .NET SDK version mismatch");
    requireOk(run(["restore",project,"--locked-mode","--source",feed,"--configfile",config,"--packages",localEnv.NUGET_PACKAGES,"-p:NuGetAudit=false"],work,localEnv),"BLOCKED_OFFLINE_RESTORE (only cached packages; no network feed)");
  }
  async function setup(work){
    await writeProject(work,original.replace(originalExpression,brokenExpression));
    restore(work,env);
    git(work,"init","-q");git(work,"config","core.autocrlf","false");git(work,"add","-A");
    git(work,"-c","user.name=Astra Simulation","-c","user.email=simulation@example.invalid","commit","-qm","fixture");
  }
  async function independentlyVerify(work){
    const candidatePath=path.join(work,implementation),st=await lstat(candidatePath);
    assert.ok(st.isFile()&&!st.isSymbolicLink()&&st.nlink===1&&st.size<=65536);
    const candidate=await readFile(candidatePath,"utf8");
    const isolated=await mkdtemp(path.join(base,"independent-"));
    try{
      const localEnv=dotnetEnv(isolated);await mkdir(localEnv.DOTNET_CLI_HOME,{recursive:true});
      const copy=path.join(isolated,"work");await writeProject(copy,candidate);restore(copy,localEnv);
      const runResult=run(["test",project,"--no-restore"],copy,localEnv);
      const intact=(await Promise.all(Object.entries(originals).map(async([file,content])=>
        await readFile(path.join(copy,file),"utf8")===(file===implementation?candidate:content)))).every(Boolean);
      return {status:intact?runResult.status:null,intact,output:runResult.output.slice(-8000),error:runResult.error.slice(-4000)};
    }finally{await rm(isolated,{recursive:true,force:true,maxRetries:3});}
  }
  async function unchanged(work){
    return (await Promise.all(Object.entries(originals).filter(([f])=>f!==implementation).map(async([f,content])=>await readFile(path.join(work,f),"utf8").then(v=>v===content,()=>false)))).every(Boolean);
  }
  // Only the dotnet/NuGet-specific variables override the RPC harness's
  // isolated home. Do not reintroduce original environment or credentials.
  const childEnv=Object.fromEntries(Object.entries(env).filter(([k])=>/^(DOTNET_|NUGET_|VSLANG$|MSBUILDDISABLENODEREUSE$|UseSharedCompilation$)/.test(k)));
  return {setup,independentlyVerify,unchanged,childEnv,originalExpression,brokenExpression};
}
