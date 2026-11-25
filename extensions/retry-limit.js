export default function (pi) {
  let enabled = false;
  const failures = new Map();
  let stopped = false;

  pi.registerCommand("retry-limit", {
    description: "Stop after three identical failed tool calls per run. Usage: on|off|status",
    async handler(args, ctx) {
      const option = args.trim() || "status";
      if (!["on", "off", "status"].includes(option)) {
        ctx.ui.notify("Usage: /retry-limit on|off|status", "error");
        return;
      }
      if (option !== "status") enabled = option === "on";
      ctx.ui.notify(`Retry limit ${enabled ? "on" : "off"}`, "info");
    },
  });

  pi.on("agent_start", () => {
    failures.clear();
    stopped = false;
  });

  pi.on("tool_result", (event, ctx) => {
    if (!enabled || stopped) return;
    const key = JSON.stringify([event.toolName, event.input], (_key, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
        : value,
    );
    if (!event.isError) {
      failures.delete(key);
      return;
    }
    const count = (failures.get(key) ?? 0) + 1;
    failures.set(key, count);
    if (count === 3) {
      stopped = true;
      ctx.abort();
      ctx.ui.notify(`Retry limit stopped ${event.toolName} after 3 identical failures. Inspect its last error before starting another run.`, "warning");
    }
  });
}
