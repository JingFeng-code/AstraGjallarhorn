// Opt-in contract gate for a trusted, explicitly configured defect-repair task.
// No auto-running checks, model calls, dispatch, provider changes or policy inference.
// This is a tool-level constraint, not OS isolation or a universal completion guard.
import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { worktreeFingerprint } from "./verification-evidence.js";

const readOnly=new Set(["read","grep","find","ls","verification_status","quality_gate_status"]);
const inventory=new Set(["pwd","ls","ls -la","git status","git status --short","git log --oneline","git diff --stat"]);
const isName=s=>typeof s==="string"&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(s)&&!/[. ]$/.test(s)&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s);
export function parseQualityPolicy(raw){
  if(raw===undefined||raw==="")return null;
  const p=JSON.parse(raw);
  if(p?.version!==1||typeof p.check!=="string"||!/^node --test [a-zA-Z0-9][a-zA-Z0-9._-]{0,100}\.m?js$/.test(p.check)||
    typeof p.failureMarker!=="string"||!/^[a-zA-Z0-9_]{3,80}$/.test(p.failureMarker)||
    !Array.isArray(p.writable)||p.writable.length!==1||!p.writable.every(isName)||
    p.writable.some(name=>name.toLowerCase()===p.check.split(" ").at(-1).toLowerCase())||!/\.[cm]?[jt]s$/.test(p.writable[0])){
    throw Error("Invalid explicit quality contract; this pilot accepts one existing source file and one standalone Node test command.");
  }
  return {check:p.check,failureMarker:p.failureMarker,writable:[...p.writable]};
}
export function qualityDecision(state,final){
  if(!state||!final||state.invalid||state.pending)return "UNKNOWN_OR_BLOCKED";
  if(!state.reproduced)return "REPRODUCTION_NOT_OBSERVED";
  if(!state.edits)return "NO_IMPLEMENTATION_EDIT";
  if(state.last!==final||state.check!==final)return "FINAL_CHECK_MISSING_OR_STALE";
  if(state.review!==final)return "FINAL_REVIEW_MISSING_OR_STALE";
  return "CHECK_AND_REVIEW_OBSERVED";
}
export async function allowedEdit(root,input,policy){
  const raw=input?.path;
  if(typeof raw!=="string"||!raw||raw.includes("\0"))return false;
  const canonical=await realpath(root);
  const norm=v=>process.platform==="win32"?v.toLowerCase():v;
  // Compare lexical paths within the same root namespace first. The cwd can
  // contain a Windows short-name alias or a junction. Resolve the trusted
  // root, not an arbitrary user-supplied parent directory.
  const original=path.resolve(root);
  const candidate=path.resolve(original,raw);
  const approved=policy.writable.find(name=>
    norm(candidate)===norm(path.join(original,name))||
    norm(candidate)===norm(path.join(canonical,name)));
  if(!approved)return false;
  const expected=path.join(canonical,approved);
  const st=await lstat(candidate);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)return false;
  return norm(await realpath(candidate))===norm(expected);
}
export function registerQualityGate(pi,Type,policy,fingerprint=worktreeFingerprint,checkPath=allowedEdit){
  if(!policy)return;
  let state;
  const snap=async ctx=>fingerprint(ctx.cwd).catch(()=>null);
  const block=reason=>({block:true,reason:"Astra Quality Gate: "+reason});
  const status=async ctx=>({status:qualityDecision(state,await snap(ctx)),reproduced:!!state?.reproduced,edits:state?.edits??0,contract:policy});
  pi.on("agent_start",()=>{state={reproduced:false,edits:0,last:null,check:null,review:null,pending:null,invalid:false};});
  pi.on("before_agent_start",e=>({systemPrompt:e.systemPrompt+"\n\nExplicit repair contract (opt-in): reproduce the existing failure by running "+policy.check+" before modifying the approved source "+policy.writable.join(", ")+". Preserve all other files. After the final edit run the same check and use review_diff with scope all (or git diff). Shell commands outside the approved check and bounded inventory/review commands are unavailable in this pilot. No automatic checks. If blocked, follow the actual tool result or report the unresolved evidence."}));
  pi.on("tool_call",async(e,ctx)=>{
    if(readOnly.has(e.toolName))return;
    const active=state;
    if(!active||active.invalid)return block("Task state unavailable or invalidated; stop and report.");
    const input=e.input??{};
    let kind;
    if(e.toolName==="bash"){
      const cmd=typeof input.command==="string"&&!/[\r\n]/.test(input.command)?input.command.trim():"";
      if(inventory.has(cmd))return;
      if(cmd===policy.check)kind="check";
      else if(cmd==="git diff")kind="review";
      else return block("Shell command outside explicit contract. Use "+policy.check+" for verification, review_diff for changes, or native read tools.");
    }else if(e.toolName==="review_diff"){
      if(input.scope!==undefined&&input.scope!=="all")return block("Use review_diff with scope all for final review.");
      kind="review";
    }else if(e.toolName==="edit")kind="edit";
    else return block("Tool outside the explicit pilot contract.");
    if(active.pending)return block("A check, edit or review is already running; wait for its result.");
    if(typeof e.toolCallId!=="string")return block("Missing tool call identity.");
    // Claim before asynchronous checks so parallel calls cannot interleave.
    const pending={id:e.toolCallId,kind,before:null};
    active.pending=pending;
    const refuse=reason=>{if(active.pending===pending)active.pending=null;return block(reason);};
    try{
      if(kind==="edit"){
        if(!await checkPath(ctx.cwd,input,policy))return refuse("Write outside approved existing source: "+policy.writable.join(", "));
        if(!active.reproduced)return refuse("Run the original failing regression first: "+policy.check);
      }
      const before=await snap(ctx);
      if(!before)return refuse("Current worktree evidence is unavailable.");
      if(active.last&&active.last!==before){active.invalid=true;return refuse("Worktree changed outside the observed contract; stop and inspect.");}
      pending.before=before;
    }catch{return refuse("Cannot safely verify the current tool scope.");}
  });
  pi.on("tool_execution_end",async(e,ctx)=>{
    const active=state,p=active?.pending;
    if(!p||p.id!==e.toolCallId)return;
    try{
      const after=await snap(ctx);
      if(!p.before||!after){active.invalid=true;return;}
      if(p.kind==="edit"){
        if(e.isError===false&&after!==p.before){active.edits++;active.last=after;active.check=null;active.review=null;}
        else if(after!==p.before)active.invalid=true;
        return;
      }
      if(after!==p.before){active.invalid=true;return;}
      if(p.kind==="check"){
        if(!active.edits){
          const text=(e.result?.content??[]).filter(c=>c.type==="text").map(c=>c.text).join("\n");
          if(e.isError===true&&text.includes(policy.failureMarker)){active.reproduced=true;active.last=after;}
        }else{
          active.check=e.isError===false?after:null;
        }
      }else if(p.kind==="review"&&active.edits){
        active.review=e.isError===false&&(e.toolName!=="review_diff"||e.result?.details?.unchanged===true)?after:null;
      }
    }finally{if(active.pending===p)active.pending=null;}
  });
  pi.registerTool({name:"quality_gate_status",label:"Quality gate",description:"Read the explicit opt-in repair contract and current evidence. No execution.",parameters:Type.Object({}),
    async execute(_id,_args,_signal,_update,ctx){
      const s=await status(ctx);
      return {content:[{type:"text",text:JSON.stringify(s)}],details:s};
    }});
  pi.on("agent_end",async(_e,ctx)=>{
    const s=await status(ctx);
    ctx.ui?.notify?.("Astra Quality Gate: "+s.status,s.status==="CHECK_AND_REVIEW_OBSERVED"?"info":"warning");
  });
}
export default async function(pi){
  const raw=process.env.ASTRA_QUALITY_GATE;
  if(!raw)return;
  // Explicit invalid configuration must not silently grant unrestricted mutation.
  let policy;
  try{policy=parseQualityPolicy(raw);}catch(e){
    pi.on("tool_call",e=>readOnly.has(e.toolName)?undefined:{block:true,reason:"Astra Quality Gate: invalid explicit contract; correct configuration before proceeding."});
    pi.on("agent_end",(_e,ctx)=>ctx.ui?.notify?.("Astra Quality Gate: INVALID_CONTRACT","warning"));
    return;
  }
  const {Type}=await import("typebox");
  registerQualityGate(pi,Type,policy);
}
