const profiles = {
  local: ["read", "edit", "write", "bash"],
  cloud: ["read", "edit", "write"],
  review: ["read", "grep", "find", "ls"],
};

export default function (pi) {
  let previous;
  pi.registerCommand("tool-profile", {
    description: "Choose local, cloud, review, restore, or status without changing models",
    async handler(args, ctx) {
      const name = args.trim().toLowerCase() || "status";
      if (name === "restore") {
        if (previous) {
          pi.setActiveTools(previous);
          previous = undefined;
        }
      } else if (Object.hasOwn(profiles, name)) {
        const initial = previous ?? pi.getActiveTools();
        const available = new Set(initial);
        const tools = profiles[name].filter((tool) => available.has(tool));
        if (!tools.includes("read")) {
          ctx.ui.notify("The read tool is unavailable. Profile unchanged.", "error");
          return;
        }
        previous = initial;
        pi.setActiveTools(tools);
      } else if (name !== "status") {
        ctx.ui.notify("Usage: /tool-profile local|cloud|review|restore|status", "error");
        return;
      }
      ctx.ui.notify(`Active model tools: ${pi.getActiveTools().join(", ")}`, "info");
    },
  });
}
