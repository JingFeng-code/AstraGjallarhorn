// Evidence classifier for the synthetic pricing fixture only.
// Never execute a command or infer success from model prose.
export function isFixtureCheck(command) {
  if(typeof command!=="string"||/[\r\n]/.test(command))return false;
  return /^\s*node\s+--test(?:\s+(?:\.\/)?pricing\.test\.mjs|\s+"(?:\.\/)?pricing\.test\.mjs"|\s+'(?:\.\/)?pricing\.test\.mjs')?\s*$/.test(command);
}
export function inspectCalls(events, isCheck=isFixtureCheck) {
  const starts=new Map();
  const calls=[];
  for(const [index,e] of events.entries()){
    if(e.type==="tool_execution_start")starts.set(e.toolCallId,{args:e.args,index});
    if(e.type!=="tool_execution_end")continue;
    const start=starts.get(e.toolCallId);
    calls.push({name:e.toolName,outcome:e.isError===true?"error":e.isError===false?"ok":"unknown",
      args:start?.args,startedAt:start?.index??null,endedAt:index});
  }
  const edits=calls.filter(c=>c.name==="edit"&&c.outcome==="ok");
  const first=edits[0],last=edits.at(-1);
  const check=c=>c.name==="bash"&&isCheck(c.args?.command);
  const afterLast=c=>last&&c.startedAt!==null&&c.startedAt>last.endedAt;
  const modelReproduced=Boolean(first&&first.startedAt!==null&&calls.some(c=>check(c)&&c.outcome==="error"&&c.endedAt<first.startedAt));
  const modelVerified=Boolean(last&&calls.some(c=>check(c)&&c.outcome==="ok"&&afterLast(c)));
  const reviewToolObserved=Boolean(calls.some(c=>c.name==="review_diff"&&c.outcome==="ok"&&afterLast(c)));
  const gitReviewObserved=Boolean(calls.some(c=>c.name==="bash"&&c.outcome==="ok"&&afterLast(c)&&/^\s*git\s+diff(?:\s+--\s+(?:\.\/)?pricing\.mjs)?\s*$/.test(c.args?.command??"")));
  return {calls,modelReproduced,modelVerified,reviewToolObserved,gitReviewObserved};
}
// Shareable diagnostics use an allowlist, not arbitrary shell arguments or output.
// For unrecognized commands, keep an explicit marker; exact local-only trace is separate.
export function publicCalls(calls, isCheck=isFixtureCheck) {
  return calls.map(c=>({name:c.name,outcome:c.outcome,startedAt:c.startedAt,endedAt:c.endedAt,
    ...(c.name==="bash"?{command:isCheck(c.args?.command)?c.args.command:
      /^\s*git\s+diff(?:\s+--\s+(?:\.\/)?pricing\.mjs)?\s*$/.test(c.args?.command??"")?c.args.command:"[unrecognized command; inspect local trace]"}:{}),
    ...(c.name==="read"?{correctSkill:/[\\/]correct[\\/]SKILL\.md$/i.test(c.args?.path??"")}:{}),
    ...(c.name==="bash"?{recognizedCheck:isCheck(c.args?.command)}:{})}));
}
