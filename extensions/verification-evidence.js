// Observe native tool events. Never execute a project verification command.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

const patterns = [
  ["project-check", /^node examples\/sql\/verify\.mjs$/],
  ["project-check", /^node examples\/vue\/verify-contract\.mjs$/],
  ["test", /^node --test(?: [a-zA-Z0-9_./-]+\.m?js)?$/],
  ["test", /^npm test$/],
  ["test", /^(?:npm run|pnpm run|yarn run) test$/],
  ["lint", /^(?:npm run|pnpm run|yarn run) lint$/],
  ["typecheck", /^(?:npm run|pnpm run|yarn run) typecheck$/],
  ["build", /^(?:npm run|pnpm run|yarn run) build$/],
  ["test", /^dotnet test(?: [a-zA-Z0-9_./-]+\.csproj)?(?: --no-build)?(?: --no-restore)?$/],
  ["build", /^dotnet build(?: [a-zA-Z0-9_./-]+\.csproj)?(?: --no-restore)?$/],
  ["test", /^(?:python -m )?pytest(?: -q)?$/],
  ["project-check", /^pwsh -NoProfile -File scripts\/verify-project\.ps1(?: -Suite (?:sql|dotnet|vue))?$/],
];
export function recognizeCheck(command) {
  if(typeof command!=="string" || command.length>240 || /[^a-zA-Z0-9_./ -]/.test(command)) return null;
  const key=command.trim().replace(/ +/g," ");
  if(/(?:^|[ /])\.\.(?:\/| |$)/.test(key)||/(?:^| )\//.test(key))return null;
  const found=patterns.find(([,re])=>re.test(key));
  return found?{kind:found[0],key}:null;
}
function git(cwd,args,timeout=5000){
  return new Promise((resolve,reject)=>execFile("git",["--no-pager",...args],{
    cwd,encoding:"buffer",timeout,maxBuffer:8*1024*1024,windowsHide:true,
    env:{...process.env,GIT_OPTIONAL_LOCKS:"0"}
  },(err,out)=>err?reject(err):resolve(out)));
}
export async function worktreeFingerprint(cwd){
  try{
    const deadline=Date.now()+8000;
    const run=(cwd,args)=>{const remaining=deadline-Date.now();if(remaining<=0)throw Error("Fingerprint budget exceeded");return git(cwd,args,Math.min(5000,remaining));};
    const root=(await run(cwd,["rev-parse","--show-toplevel"])).toString().trim();
    const h=createHash("sha256");
    const add=b=>{h.update(String(b.length)+":");h.update(b);};
    const statusArgs=["status","--porcelain=v2","-z","--untracked-files=all","--ignore-submodules=none"];
    const initial=await run(root,statusArgs);
    add(initial);
    for(const args of [
      ["rev-parse","--verify","HEAD"],
      ["diff","--cached","--binary","--no-ext-diff","--no-textconv"],
      ["diff","--binary","--no-ext-diff","--no-textconv"]
    ])add(await run(root,args));
    const untracked=(await run(root,["ls-files","-z","--others","--exclude-standard"])).toString().split("\0").filter(Boolean);
    if(untracked.length>32)return null;
    const realRoot=await realpath(root);
    for(const name of untracked){
      const file=path.resolve(root,name),st=await lstat(file);
      if(!st.isFile()||st.size>8*1024*1024||/(?:^|\/)(?:\.env(?:\..*)?|auth\.json|credentials\.json|[^/]*\.(?:pem|key|pfx))$/i.test(name))return null;
      const actual=await realpath(file),rel=path.relative(realRoot,actual);
      if(rel===".."||rel.startsWith(".."+path.sep)||path.isAbsolute(rel))return null;
      add(Buffer.from(name));add(await run(root,["hash-object","--no-filters","--",name]));
    }
    if(!initial.equals(await run(root,statusArgs)))return null;
    return h.digest("hex");
  }catch{return null;}
}
export function summarizeEvidence(initial,final,records,incomplete=false){
  const checks=[...records.values()].map(r=>({kind:r.kind,toolCallId:r.id,result:r.result,
    current:Boolean(final&&r.before===final&&r.after===final&&r.result!=="unknown")}));
  const changed=initial&&final?initial!==final:null;
  let status="NOT_OBSERVED";
  if(!initial||!final||incomplete)status="UNKNOWN";
  else if(checks.some(c=>c.result==="error"))status="CHECK_ERROR_OBSERVED";
  else if(checks.some(c=>!c.current))status="STALE_OR_UNKNOWN";
  else if(checks.some(c=>c.current&&c.result==="ok"))status="CHECKS_OBSERVED_OK";
  else if(changed)status="CHANGES_UNVERIFIED";
  return {status,changed,checks};
}
// Review access is separate from a successful test/build/lint; it cannot
// satisfy a verification requirement on its own.
const isReview=e=>e.toolName==="review_diff"||(e.toolName==="bash"&&/^[ \t]*git[ \t]+diff[ \t]*$/.test(e.args?.command??""));
const nativeWrites=new Set(["edit","write","multiedit","hashline_replace","notebook_edit"]);
const isTestPath=value=>typeof value==="string"&&/(?:[\\/](?:tests?|__tests__|specs?)[\\/]|(?:^|[\\/])(?:tests?|__tests__|specs?)[\\/]|[._-](?:test|spec)\.[a-z0-9]+$|Tests\.cs$)/i.test(value);
export function deliveryEvidence(s,review,final){
  const reviewCurrent=Boolean(final&&review?.ok===true&&review.before===final&&review.after===final);
  let delivery="NOT_APPLICABLE";
  if(s.status==="UNKNOWN"||s.changed===null)delivery="UNKNOWN";
  else if(s.changed){
    if(s.status!=="CHECKS_OBSERVED_OK")delivery="CHECKS_MISSING_OR_STALE";
    else if(!reviewCurrent)delivery="FINAL_REVIEW_NOT_OBSERVED";
    else delivery="CHECK_AND_REVIEW_OBSERVED";
  }
  return {...s,reviewCurrent,delivery};
}
const readonlyTools=new Set(["read","grep","find","ls","review_diff","checkpoint_preview","verification_status","lsp_diagnostics","lsp_definition","lsp_references"]);
const labels={NOT_OBSERVED:"未觀察",CHANGES_UNVERIFIED:"修改未驗證",CHECK_ERROR_OBSERVED:"檢查失敗",STALE_OR_UNKNOWN:"證據過期或不確定",CHECKS_OBSERVED_OK:"觀察到檢查成功",UNKNOWN:"證據未知"};
export function registerEvidence(pi,Type,fingerprint=worktreeFingerprint){
  let turn;
  const snap=async ctx=>fingerprint(ctx.cwd).catch(()=>null);
  const setStatus=(ctx,text)=>ctx.ui?.setStatus?.("astra-verification",text);
  const summary=async ctx=>{
    if(!turn?.baseline)return {status:"NOT_OBSERVED",changed:null,checks:[],reviewCurrent:false,delivery:"NOT_APPLICABLE"};
    const active=turn,initial=await active.baseline,final=await snap(ctx);
    return deliveryEvidence(summarizeEvidence(initial,final,active.records,active.pending.size>0||active.incomplete),active.review,final);
  };
  pi.on("session_start",(_e,ctx)=>{turn=undefined;setStatus(ctx,undefined);});
  pi.on("agent_start",(_e,ctx)=>{
    turn={baseline:null,records:new Map(),pending:new Map(),incomplete:false,reviewPending:new Map(),review:null,edited:false,feedback:new Set()};
    setStatus(ctx,undefined);
  });
  pi.on("tool_execution_start",async(e,ctx)=>{
    const active=turn,check=e.toolName==="bash"?recognizeCheck(e.args?.command):null;
    if(!active)return;
    if(isReview(e)&&active.baseline){
      if(active.reviewPending.size>=8){active.review=null;return;}
      const r={before:null};active.reviewPending.set(e.toolCallId,r);r.before=await snap(ctx);return;
    }
    if(readonlyTools.has(e.toolName))return;
    // Lazy baseline: text-only and known read-only turns never invoke Git.
    active.baseline??=snap(ctx);
    await active.baseline;
    setStatus(ctx,"驗證：待核對");
    if(!check)return;
    if(active.pending.size>=32||(!active.records.has(check.key)&&active.records.size>=32)){active.incomplete=true;return;}
    if([...active.pending.values()].some(p=>p.key===check.key))active.incomplete=true;
    const record={...check,id:e.toolCallId,before:null};active.pending.set(e.toolCallId,record);
    record.before=await snap(ctx);
  });
  pi.on("tool_execution_end",async(e,ctx)=>{
    const active=turn;
    const review=active?.reviewPending.get(e.toolCallId);
    if(review){
      review.after=await snap(ctx);review.ok=e.isError===false&&e.result?.details?.unchanged!==false;
      active.reviewPending.delete(e.toolCallId);active.review=review;return;
    }
    const record=active?.pending.get(e.toolCallId);
    if(!record)return;
    record.after=await snap(ctx);
    record.result=e.isError===true?"error":e.isError===false?"ok":"unknown";
    active.pending.delete(e.toolCallId);active.records.set(record.key,record);
    setStatus(ctx,record.result==="error"?"驗證：檢查失敗":"驗證：待核對");
  });
  // Piggyback on model-facing tool results, not a new model turn. At most
  // three distinct short reminders per task; no command execution or blocking.
  pi.on("tool_result",e=>{
    const active=turn;
    if(!active||e.isError!==false||!Array.isArray(e.content))return;
    const input=e.input??{};
    const checked=active.records.size>0||active.pending.size>0;
    let key,message;
    if(e.toolName==="read"&&!active.edited&&!checked&&isTestPath(input.path??input.file_path)){
      key="reproduce";
      message="Astra evidence: For a defect repair, run the project's safe existing regression before editing; a handwritten example alone is not that regression. Read-only analysis needs no test run.";
    }else if(nativeWrites.has(e.toolName)){
      active.edited=true;
      key="edit";
      message="Astra evidence: Files changed. Preserve approved test expectations. After the final edit run the original documented checks and inspect the final diff; report anything not verified.";
    }else if(e.toolName==="bash"&&active.edited&&recognizeCheck(input.command)){
      key="review";
      message="Astra evidence: A check returned successfully, not proof of full acceptance. Inspect the final diff now; if editing again, rerun affected checks.";
    }
    if(!key||active.feedback.has(key))return;
    active.feedback.add(key);
    return {content:[...e.content,{type:"text",text:message}]};
  });
  pi.on("agent_end",async(_e,ctx)=>{
    const s=await summary(ctx);
    if(!turn?.baseline)return;
    setStatus(ctx,"驗證："+labels[s.status]+(s.delivery==="FINAL_REVIEW_NOT_OBSERVED"?"／未觀察最終差異":""));
    if(!s.changed&&!s.checks.length&&s.status!=="UNKNOWN")return;
    ctx.ui?.notify?.("驗證證據："+s.status+"；交付證據："+s.delivery+"（"+s.checks.length+" 項已辨識檢查；非完整驗收）",s.status==="CHECKS_OBSERVED_OK"&&s.delivery!=="FINAL_REVIEW_NOT_OBSERVED"?"info":"warning");
  });
  pi.registerTool({
    name:"verification_status",label:"驗證證據",
    description:"Read-only observation of recognized verification commands in this turn and whether their Git worktree fingerprints still match. Separately reports current diff-review access; does not execute tests or certify completion.",
    promptSnippet:"Inspect observed verification evidence and stale checks before reporting",
    parameters:Type.Object({}),
    async execute(_id,_params,_signal,_update,ctx){
      const s=await summary(ctx);
      return {content:[{type:"text",text:JSON.stringify(s)+"\nObserved tool outcomes only. Not proof of test coverage, correctness, ignored/external state or production verification. Unrecognized commands are not counted. CHECK_AND_REVIEW_OBSERVED means access and tool outcomes, not review quality or approved scope."}],details:s};
    }
  });
}
export default async function(pi){
  const {Type}=await import("typebox");registerEvidence(pi,Type);
}
