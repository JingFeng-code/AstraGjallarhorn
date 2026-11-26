const POLICY_ENTRY = "astragjallarhorn-retry-policy";
const HANDOFF_ENTRY = "astragjallarhorn-retry-handoff";
const policies = ["on", "strict", "off"];

export default function (pi) {
  let policy = "on";
  const failures = new Map();
  const calls = new Map();
  const argsById = new Map();
  let stopped = false;
  let lastFailedTool;
  let consecutive = 0;

  pi.registerCommand("retry-limit", {
    description: "Limit tool failures per run (identical failures on by default). Usage: on|strict|off|status|handoff",
    async handler(args, ctx) {
      const option = args.trim() || "status";
      if (option === "handoff") {
        const entry = ctx.sessionManager.getEntries().findLast((item) =>
          item.type === "custom" && item.customType === HANDOFF_ENTRY);
        ctx.ui.notify(entry?.data?.summary ?? "No retry-limit handoff in this session.", "info");
        return;
      }
      if (policies.includes(option)) {
        policy = option;
        pi.appendEntry(POLICY_ENTRY, { policy });
      } else if (option !== "status") {
        ctx.ui.notify("Usage: /retry-limit on|strict|off|status|handoff", "error");
        return;
      }
      ctx.ui.notify(`Retry limit ${policy}`, "info");
    },
  });

  pi.on("session_start", (_event, ctx) => {
    const entry = ctx.sessionManager.getEntries().findLast((item) =>
      item.type === "custom" && item.customType === POLICY_ENTRY);
    policy = policies.includes(entry?.data?.policy) ? entry.data.policy : "on";
  });

  pi.on("agent_start", () => {
    failures.clear();
    calls.clear();
    argsById.clear();
    stopped = false;
    lastFailedTool = undefined;
    consecutive = 0;
  });

  pi.on("tool_execution_start", (event) => {
    if (policy === "off" || stopped) return;
    const key = JSON.stringify([event.toolName, event.args], (_key, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
        : value,
    );
    calls.set(event.toolCallId, key);
    argsById.set(event.toolCallId, event.args);
  });

  pi.on("tool_execution_end", (event, ctx) => {
    if (policy === "off" || stopped) return;
    const key = calls.get(event.toolCallId);
    if (key === undefined) return;
    calls.delete(event.toolCallId);
    if (!event.isError) {
      failures.delete(key);
      lastFailedTool = undefined;
      consecutive = 0;
      return;
    }
    const count = (failures.get(key) ?? 0) + 1;
    failures.set(key, count);
    consecutive = lastFailedTool === event.toolName ? consecutive + 1 : 1;
    lastFailedTool = event.toolName;
    if (count === 3 || (policy === "strict" && consecutive === 3)) {
      stopped = true;
      const reason = count === 3 ? "3 identical failures" : "3 consecutive failures";
      const summary = `Retry limit stopped ${event.toolName} after ${reason}. Last tool call: ${event.toolCallId}. Review its error in this session before resuming; pass this summary to Herdr manually if needed.`;
      ctx.abort();
      pi.appendEntry(HANDOFF_ENTRY, { summary });
      pi.events?.emit("astra:retry-stopped", {
        policy, reason, tool: event.toolName, toolCallId: event.toolCallId, args: argsById.get(event.toolCallId),
        error: JSON.stringify(event.result ?? null).slice(0, 1200), summary,
      });
      ctx.ui.notify(summary, "warning");
    }
  });
}
