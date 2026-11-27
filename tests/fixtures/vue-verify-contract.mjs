// Copied into the isolated fixture by the trusted launcher.
// Use the same original npm scripts that pass the repository's Vue CI.
// npm is invoked by its installed CLI path with offline/config isolation.
import {spawnSync} from "node:child_process";
import {lstatSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
const cwd=fileURLToPath(new URL(".",import.meta.url));
const npm=process.env.ASTRA_VUE_NPM_CLI;
const commands=[
  ["unit",["test"]],
  ["lint",["run","lint"]],
  ["typecheck",["run","typecheck"]],
  ["build",["run","build"]],
  ["browser",["run","test:e2e"]]
];
function verify(){
  if(!npm||!path.isAbsolute(npm)||path.basename(npm)!=="npm-cli.js"||!lstatSync(npm,{throwIfNoEntry:false})?.isFile()){
    console.error("BLOCKED_NPM_CLI: installed npm CLI not available");return 2;
  }
  // The existing Vite binary must be present; npm exec must not install a
  // replacement. The preview command also explicitly sets offline/yes=false.
  if(!lstatSync(path.join(cwd,"node_modules","vite","bin","vite.js"),{throwIfNoEntry:false})?.isFile()){
    console.error("BLOCKED_LOCAL_VITE: installed Vite missing");return 2;
  }
  for(const [label,args] of commands){
    const started=Date.now();
    console.log("START: "+label+" (npm "+args.join(" ")+")");
    const env={...process.env,CI:"1",NO_COLOR:"1",FORCE_COLOR:"0",PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:"1",npm_config_offline:"true",npm_config_yes:"false"};
    if(label==="browser"){
      const tmp=process.env.ASTRA_VUE_BROWSER_TMP;
      if(!tmp||!path.isAbsolute(tmp)||!lstatSync(tmp,{throwIfNoEntry:false})?.isDirectory()){
        console.error("BLOCKED_EDGE_TEMP: canonical isolated browser temp missing");return 2;
      }
      // Keep the Playwright/test runner's synthetic home. Only Edge receives
      // its normal Windows known-folder environment from launchOptions.env.
      // Playwright uses this canonical temp path for a fresh browser profile.
      Object.assign(env,{TEMP:tmp,TMP:tmp,TMPDIR:tmp});
      console.log("Edge: Windows OS environment allowlist; fresh temporary profile");
    }
    const run=spawnSync(process.execPath,[npm,"--offline","--ignore-scripts","--no-audit","--no-fund","--yes=false",...args],{
      cwd,env,
      encoding:"utf8",timeout:90000,maxBuffer:4*1024*1024,windowsHide:true
    });
    const output=String(run.stdout??"")+"\n"+String(run.stderr??"");
    process.stdout.write(output);
    console.log("END: "+label+" status="+String(run.status)+" signal="+String(run.signal)+" elapsedMs="+(Date.now()-started));
    if(run.error){console.error("BLOCKED "+label+": "+run.error.message);return 2;}
    if(run.status!==0){
      if(label==="unit"&&run.status===1&&/AssertionError/.test(output)&&output.includes("normalizes leading, trailing, and internal space")){
        console.log("ASTRA_VUE_TITLE_REGRESSION");
      }
      console.log("FAIL: "+label+" ("+run.status+")");
      return run.status??2;
    }
    console.log("PASS: "+label);
  }
  console.log("PASS: Vue original regression, lint, typecheck, build and browser");
  return 0;
}
// Allow stdout/stderr to drain before exit rather than truncating diagnostics.
process.exitCode=verify();
