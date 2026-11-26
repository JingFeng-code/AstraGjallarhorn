// Native Pi tool routing. No extra model request, subprocess, file write, model
// switch, or permission change. Tool observations are not proof of correctness.
export const workflows = Object.freeze({
  fix: "先重現、定位根因；必要時讀取 correct Skill；最小修正、重跑失敗測試及相關回歸、最後審查。",
  feature: "釐清關鍵需求與驗收條件；必要時讀取 architect Skill；實作、驗證、審查。",
  refactor: "先建立行為基準；維持契約；最小重構、回歸、審查。",
  analyze: "唯讀分析；說明證據、影響範圍與待釐清事項。",
  review: "唯讀審查；優先使用可用的 review_diff，讀取相關檔案，依嚴重度回報。",
  recover: "先確認現有任務紀錄；不自行執行不可逆操作或覆蓋外部修改。",
  report: "依已取得的證據整理報告；區分已驗證、未驗證與阻塞。",
});
const implementation = new Set(["fix", "feature", "refactor"]);
export function createTracker() {
  let route, shell, errors, review, activity;
  function reset() { route = undefined; shell = errors = activity = 0; review = false; }
  reset();
  return {
    reset,
    begin(kind) {
      if (!Object.hasOwn(workflows, kind)) return false;
      if (route) return route === kind;
      route = kind;
      return true;
    },
    observe(event) {
      if (!route) return;
      if (event.toolName === "workflow_begin") return;
      if (event.isError === true) errors++;
      // A shell call can mutate the tree. Do not infer its purpose or exit
      // status from a command string; a later review must follow it.
      if (event.toolName === "bash") { shell++; activity++; review = false; }
      else if (["edit", "write"].includes(event.toolName)) { activity++; review = false; }
      else if (event.toolName === "review_diff") {
        review = event.isError === false && event.result?.details?.unchanged === true;
      }
      // Unknown tools are not classified as read-only or as successful tests.
    },
    snapshot() {
      return { route: route ?? null, shell, errors, activity, reviewObserved: review,
        missingEvidence: implementation.has(route) && (!shell || !review) };
    },
  };
}
export function registerWorkflow(pi, Type) {
  const tracker = createTracker();
  const status = (ctx) => {
    const s = tracker.snapshot();
    ctx.ui?.setStatus?.("astra-workflow", s.route ? "工作流: " + s.route : undefined);
    return s;
  };
  pi.on("session_start", (_e, ctx) => { tracker.reset(); status(ctx); });
  pi.on("agent_start", (_e, ctx) => { tracker.reset(); status(ctx); });
  pi.on("tool_execution_end", (event) => tracker.observe(event));
  pi.on("agent_end", (_e, ctx) => {
    const s = status(ctx);
    if (s.missingEvidence) ctx.ui?.notify?.("工作流提醒：未觀察到 shell 執行或最後的 review_diff 證據。請核對實際驗證；不能視為完整交付。", "warning");
  });
  pi.registerTool({
    name: "workflow_begin",
    label: "選擇工程工作流",
    description: "Select one engineering workflow from the user's actual intent. No model switch, permissions or external calls. Use once before engineering actions; do not use for casual questions or hypothetical examples.",
    promptSnippet: "Select an engineering workflow from natural-language intent",
    promptGuidelines: ["For a concrete engineering task, call workflow_begin before work; choose the route semantically, not by keyword. Follow its returned instructions and project AGENTS.md. For analysis or review, stay read-only. If unavailable, follow AGENTS.md without claiming the tool ran."],
    parameters: Type.Object({ kind: Type.Union(Object.keys(workflows).map(k => Type.Literal(k))) }),
    async execute(_id, params, _signal, _update, ctx) {
      if (!tracker.begin(params.kind)) return { content: [{type:"text",text:"工作流無效或本輪已選擇其他工作流。"}], isError:true };
      const s = status(ctx);
      const available = pi.getActiveTools();
      return { content: [{type:"text",text:workflows[s.route] + "\n目前可用工具：" + available.join(", ") + "\n只使用目前已授權工具；不得自行切換模型、安裝、部署、交接或修改正式環境。驗證須依專案文件及實際輸出，不能把工具呼叫當作測試通過。"}], details:{route:s.route} };
    },
  });
  pi.registerCommand("workflow", {
    description: "查看本輪工作流與觀察到的工具證據",
    async handler(_args, ctx) {
      const s = status(ctx);
      ctx.ui?.notify?.(JSON.stringify(s) + "（工具觀察，非驗收結果）", "info");
    },
  });
}
export default async function (pi) {
  const { Type } = await import("typebox");
  registerWorkflow(pi, Type);
}
