// Fixed Vue fixture, offline npm cache only, no browser install.
// Candidate code is not OS-sandboxed.
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir,mkdtemp,rm,lstat} from "node:fs/promises";
import {execFileSync,spawnSync} from "node:child_process";
import {homedir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
export const implementation="examples/vue/src/title.ts";
export const testFile="examples/vue/src/title.test.ts";
export const verifier="examples/vue/verify-contract.mjs";
export const check="node "+verifier;
export const isVueCheck=c=>typeof c==="string"&&!/[\r\n]/.test(c)&&c.trim()===check;
export const policy={version:4,kind:"vue-title",check,failureMarker:"ASTRA_VUE_TITLE_REGRESSION",writable:[implementation]};
const repo=fileURLToPath(new URL("../../",import.meta.url));
const names=[".gitignore","README.md","e2e/title.spec.mjs","eslint.config.mjs","index.html","package-lock.json","package.json","playwright.config.mjs","src/NoteEditor.vue","src/main.ts","src/title.test.ts","src/title.ts","tsconfig.json","vite.config.mjs"].map(f=>"examples/vue/"+f);
export const git=(cwd,...args)=>execFileSync("git",args,{cwd,encoding:"utf8",timeout:30000});
const originalExpression="input.trim().replace",brokenExpression="input.replace";
function run(script,args,cwd,env,timeout=180000){
  const result=spawnSync(process.execPath,[script,...args],{cwd,env,encoding:"utf8",timeout,maxBuffer:4*1024*1024,windowsHide:true});
  return {status:result.error?null:result.status,output:String(result.stdout??""),error:String(result.stderr??"")+(result.error?"\n"+result.error.message:"")};
}
function fixtureEnv(base,cache){
  const allowed=new Set(["path","systemroot","windir","comspec","pathext","programfiles","programfiles(x86)","programw6432","os","systemdrive","lang","lc_all","shell"]);
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>allowed.has(k.toLowerCase())));
  const home=path.join(base,"vue-home"),empty=path.join(base,"empty.npmrc");
  return {...env,HOME:home,USERPROFILE:home,APPDATA:home,LOCALAPPDATA:home,TEMP:base,TMP:base,TMPDIR:base,
    npm_config_cache:cache,npm_config_userconfig:empty,npm_config_globalconfig:path.join(base,"global.npmrc"),
    npm_config_offline:"true",npm_config_audit:"false",npm_config_fund:"false",npm_config_ignore_scripts:"true",
    npm_config_logs_dir:path.join(base,"npm-logs"),PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:"1",CI:"1",NO_COLOR:"1",FORCE_COLOR:"0"};
}
async function npmCli(){
  const candidates=[process.env.npm_execpath,path.join(path.dirname(process.execPath),"node_modules","npm","bin","npm-cli.js"),path.resolve(path.dirname(process.execPath),"../lib/node_modules/npm/bin/npm-cli.js")].filter(Boolean);
  for(const file of candidates)if(path.basename(file)==="npm-cli.js"&&(await lstat(file).catch(()=>null))?.isFile())return file;
  throw Error("BLOCKED_NPM_CLI: existing npm-cli.js not found; no installation");
}
export async function vueFixture(base){
  assert.equal(process.platform,"win32","This Edge fixture currently targets Windows");
  assert.match(process.version,/^v24\./,"Existing Node 24 required");
  const npm=await npmCli();
  const cache=path.resolve(process.env.npm_config_cache||process.env.NPM_CONFIG_CACHE||path.join(process.env.LOCALAPPDATA||path.join(homedir(),"AppData","Local"),"npm-cache"));
  if(!(await lstat(path.join(cache,"_cacache")).catch(()=>null))?.isDirectory())throw Error("BLOCKED_OFFLINE_NPM_CACHE: existing npm cache missing; no downloads");
  const originals=Object.fromEntries(await Promise.all(names.map(async f=>[f,await readFile(path.join(repo,f),"utf8")])));
  const source=originals[implementation];assert.ok(source.includes(originalExpression)&&!source.includes(brokenExpression));
  // Preserve the known-green npm-script preview path; require offline/no
  // install confirmation, and pipe web-server startup diagnostics in failures.
  const config="examples/vue/playwright.config.mjs",old="npm exec -- vite preview";
  assert.ok(originals[config].includes(old));
  originals[config]=originals[config].replace(old,"npm exec --offline --yes=false -- vite preview")
    .replace("reuseExistingServer: false,","reuseExistingServer: false,\n    stdout: \"pipe\",\n    stderr: \"pipe\",");
  originals[verifier]=await readFile(path.join(repo,"tests/fixtures/vue-verify-contract.mjs"),"utf8");
  originals["README.md"]="# Notes maintenance incident\nSaved titles must normalize leading, trailing and internal whitespace. Run "+check+" before and after repair. The verifier runs the original unit test, lint, typecheck, build and browser test. Only "+implementation+" may change. Dependencies are prepared offline by the harness; do not install anything.\n";
  async function prepareEnv(dir){
    const env={...fixtureEnv(dir,cache),ASTRA_VUE_NPM_CLI:npm,npm_config_yes:"false"};
    await mkdir(env.HOME,{recursive:true});
    await writeFile(env.npm_config_userconfig,"");
    await writeFile(env.npm_config_globalconfig,"");
    return env;
  }
  const env=await prepareEnv(base);
  async function writeProject(work,candidate){
    for(const [file,content] of Object.entries(originals)){
      await mkdir(path.dirname(path.join(work,file)),{recursive:true});
      await writeFile(path.join(work,file),file===implementation?candidate:content);
    }
  }
  function restore(work,localEnv){
    const result=run(npm,["ci","--offline","--ignore-scripts","--no-audit","--no-fund","--cache",cache],path.join(work,"examples/vue"),localEnv);
    assert.equal(result.status,0,"BLOCKED_OFFLINE_NPM_CACHE (no downloads)\n"+(result.output+result.error).slice(-6000));
  }
  async function setup(work){
    await writeProject(work,source.replace(originalExpression,brokenExpression));
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
      const localEnv=await prepareEnv(isolated),copy=path.join(isolated,"work");
      await writeProject(copy,candidate);restore(copy,localEnv);
      const result=run(path.join(copy,verifier),[],copy,localEnv,240000);
      const intact=(await Promise.all(Object.entries(originals).map(async([file,content])=>
        await readFile(path.join(copy,file),"utf8")===(file===implementation?candidate:content)))).every(Boolean);
      return {status:intact?result.status:null,intact,output:result.output.slice(-16000),error:result.error.slice(-4000)};
    }finally{await rm(isolated,{recursive:true,force:true,maxRetries:3});}
  }
  async function unchanged(work){
    return (await Promise.all(Object.entries(originals).filter(([f])=>f!==implementation).map(async([f,content])=>await readFile(path.join(work,f),"utf8").then(v=>v===content,()=>false)))).every(Boolean);
  }
  const childEnv=Object.fromEntries(Object.entries(env).filter(([k])=>/^(npm_config_|PLAYWRIGHT_|ASTRA_VUE_NPM_CLI$|CI$|NO_COLOR$|FORCE_COLOR$)/.test(k)));
  return {setup,independentlyVerify,unchanged,childEnv,originalExpression,brokenExpression};
}
