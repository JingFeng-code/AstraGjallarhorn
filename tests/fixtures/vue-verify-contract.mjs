// Copied into the isolated Vue fixture by its trusted launcher.
// Run the original locked local executables directly, not npm exec (no fetch).
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";
const cwd=fileURLToPath(new URL(".",import.meta.url));
const commands=[
  ["unit","vitest/vitest.mjs",["run"]],
  ["lint","eslint/bin/eslint.js",["."]],
  ["typecheck","vue-tsc/bin/vue-tsc.js",["--noEmit"]],
  ["build","vite/bin/vite.js",["build"]],
  ["browser","@playwright/test/cli.js",["test"]]
];
for(const [label,bin,args] of commands){
  const run=spawnSync(process.execPath,[path.join(cwd,"node_modules",bin),...args],{
    cwd,env:{...process.env,CI:"1",NO_COLOR:"1",FORCE_COLOR:"0",PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:"1",npm_config_offline:"true"},
    encoding:"utf8",timeout:90000,maxBuffer:4*1024*1024,windowsHide:true
  });
  const output=String(run.stdout??"")+"\n"+String(run.stderr??"");
  process.stdout.write(output);
  if(run.error){console.error("BLOCKED "+label+": "+run.error.message);process.exit(2);}
  if(run.status!==0){
    if(label==="unit"&&run.status===1&&/AssertionError/.test(output)&&output.includes("normalizes leading, trailing, and internal space")){
      console.log("ASTRA_VUE_TITLE_REGRESSION");
    }
    console.log("FAIL: "+label+" ("+run.status+")");
    process.exit(run.status??2);
  }
  console.log("PASS: "+label);
}
console.log("PASS: Vue original regression, lint, typecheck, build and browser");
