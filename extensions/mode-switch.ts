/**
 * mode-switch — two Pi work modes with model independence.
 *
 * Modes:
 *   default        — 一般模式: native Pi behavior, no extra rules or resources.
 *   deep-execution — 深度執行: deepseek-stack skills + plan→execute→verify→fix rules.
 *
 * The mode only controls skills and system-prompt instructions. It never
 * changes the provider, model, thinking level, tools, MCP servers, or session.
 *
 * State lives in Pi session entries. The legacy file supplies a read-only default. Skills stay outside Pi's
 * auto-discovered directories and are contributed through the official
 * `resources_discover` event only while deep-execution is active, so the
 * default mode never advertises them.
 */

import { readFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const HOME = homedir();
const PI_ROOT = path.join(HOME, ".pi");
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? path.join(PI_ROOT, "agent");
const STATE_FILE = path.join(AGENT_DIR, "mode-state.json");
const MODES_ROOT = path.join(path.dirname(path.resolve(AGENT_DIR)), "modes");
const DEEP_DIR = path.join(MODES_ROOT, "deep-execution");
const DEEP_SKILLS_DIR = path.join(DEEP_DIR, "skills");
const DEEP_INSTRUCTIONS = path.join(DEEP_DIR, "instructions.md");

const MODE_ENTRY = "astragjallarhorn-mode";
const MODE_IDS = ["default", "deep-execution"];

const MODE_META = {
	"default": {
		label: "一般模式",
		description: "Pi 原生行為；不加入 deepseek-stack 規則。",
	},
	"deep-execution": {
		label: "深度執行",
		description: "規劃 → 執行 → 驗證 → 修正；載入 ds-* Skills。",
	},
};

async function readMode(ctx) {
	const entry = ctx.sessionManager.getEntries().findLast((entry) =>
		entry.type === "custom" && entry.customType === MODE_ENTRY && MODE_IDS.includes(entry.data?.mode)
	);
	if (entry) return entry.data.mode;
	try {
		const raw = JSON.parse(await readFile(STATE_FILE, "utf8"));
		const mode = typeof raw?.mode === "string" ? raw.mode : "default";
		return MODE_IDS.includes(mode) ? mode : "default";
	} catch {
		return "default";
	}
}

function normalizeMode(input) {
	if (typeof input !== "string") return undefined;
	const value = input.trim().toLowerCase();
	if (value === "" ) return undefined;
	if (["default", "一般", "一般模式", "native"].includes(value)) return "default";
	if (["deep-execution", "deep", "深度", "深度執行", "深度执行"].includes(value)) return "deep-execution";
	return undefined;
}

function labelOf(mode) {
	return MODE_META[mode]?.label ?? mode;
}

async function fileExists(filePath) {
	try {
		await access(filePath, fsConstants.F_OK);
		return true;
	} catch {
		return false;
	}
}

function skillNames(options) {
	const skills = options?.skills;
	if (!Array.isArray(skills)) return [];
	return skills
		.map((skill) => (typeof skill === "string" ? skill : skill?.name))
		.filter((name) => typeof name === "string" && name.trim() !== "");
}

function modelLabel(ctx) {
	const model = ctx?.model;
	if (!model) return "未取得（由 Pi 目前設定決定）";
	const provider = model.provider ?? model.providerId ?? "?";
	const id = model.id ?? model.modelId ?? model.name ?? "?";
	return String(id).startsWith(`${provider}/`) ? id : `${provider}/${id}`;
}

async function buildStatus(pi, ctx) {
	const mode = await readMode(ctx);
	const options = typeof ctx?.getSystemPromptOptions === "function" ? ctx.getSystemPromptOptions() : undefined;
	const names = skillNames(options);
	const dsSkills = names.filter((name) => name.startsWith("ds-")).sort();
	const allTools = typeof pi?.getAllTools === "function" ? pi.getAllTools().map((tool) => tool.name) : [];
	const pluginTools = ["agnes_image", "agnes_video", "ollama_web_search", "ollama_web_fetch"].filter((name) => allTools.includes(name));
	const hasInstructions = await fileExists(DEEP_INSTRUCTIONS);
	const deepActive = mode === "deep-execution";
	const lines = [
		`模式：${labelOf(mode)}（${mode}）`,
		`說明：${MODE_META[mode]?.description ?? ""}`,
		`模型：${modelLabel(ctx)}`,
		`已載入 Skills：${names.length} 個`,
		`ds-* Skills：${dsSkills.length} 個${dsSkills.length > 0 ? `（${dsSkills.join(", ")}）` : ""}`,
		`深度執行指引：${deepActive ? (hasInstructions ? "已套用" : "設定檔缺失") : "未套用"}`,
		`工具總數：${allTools.length} 個；外掛工具：${pluginTools.length > 0 ? pluginTools.join(", ") : "未偵測到"}`,
		`Skills 來源：${DEEP_SKILLS_DIR}`,
		`舊版預設值來源：${STATE_FILE}`,
		`快捷鍵：Alt+M 切換模式`,
	];
	return { mode, report: lines.join("\n") };
}

export default function modeSwitchExtension(pi) {
	// The shortcut cannot reload directly (shortcut handlers get a plain
	// ExtensionContext). Routing through the /mode command keeps one switching
	// implementation and lets the command run Pi's reload.
	function toggleThroughCommand() {
		pi.sendUserMessage("/mode toggle", { expandPromptTemplates: true });
	}
	pi.on("session_start", async (event, ctx) => {
		const mode = await readMode(ctx);
		try {
			ctx.ui?.setStatus?.("mode", `模式: ${labelOf(mode)}`);
		} catch {
			// non-TUI modes have no status line
		}
		if (event.reason === "reload" && ctx.hasUI) {
			try {
				ctx.ui?.notify?.(`目前模式：${labelOf(mode)}（Alt+M 切換）`, "info");
			} catch {
				// ignore stale UI
			}
		}
	});

	// Deep-execution skills are contributed only while that mode is active.
	// They are not in any auto-discovered directory, so 一般模式 cannot see them.
	pi.on("resources_discover", async (_event, ctx) => {
		const mode = await readMode(ctx);
		if (mode !== "deep-execution") return undefined;
		if (!(await fileExists(DEEP_SKILLS_DIR))) return undefined;
		return { skillPaths: [DEEP_SKILLS_DIR] };
	});

	// Deep-execution working rules are appended to the system prompt per turn.
	pi.on("before_agent_start", async (event, ctx) => {
		const mode = await readMode(ctx);
		if (mode !== "deep-execution") return undefined;
		try {
			const rules = (await readFile(DEEP_INSTRUCTIONS, "utf8")).trim();
			if (rules === "") return undefined;
			return {
				systemPrompt: `${event.systemPrompt}\n\n<deep-execution-mode>\n${rules}\n</deep-execution-mode>`,
			};
		} catch {
			return undefined;
		}
	});

	pi.registerCommand("mode", {
		description: "切換工作模式：/mode [use <default|deep-execution> | status | toggle]",
		getArgumentCompletions: (prefix) => {
			const values = ["default", "deep-execution", "status", "toggle", "hotkey"];
			const matches = values.filter((value) => value.startsWith(prefix));
			return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const [subcommandRaw, ...rest] = args.trim().split(/\s+/).filter(Boolean);
			const subcommand = subcommandRaw ?? "";

			if (subcommand === "status" || subcommand === "") {
				const { report } = await buildStatus(pi, ctx);
				process.stderr.write(`${report}\n`);
				pi.sendMessage({
					customType: "mode-switch",
					content: report,
					display: true,
					details: { kind: "status" },
				});
				return;
			}

			if (subcommand === "hotkey") {
				await toggleThroughCommand();
				return;
			}

			let target;
			if (subcommand === "toggle") {
				const current = await readMode(ctx);
				target = current === "deep-execution" ? "default" : "deep-execution";
			} else if (subcommand === "use") {
				target = normalizeMode(rest.join(" "));
			} else {
				target = normalizeMode([subcommand, ...rest].join(" "));
			}

			if (target === undefined) {
				const usage = "用法：/mode [use <default|deep-execution> | status | toggle]";
				process.stderr.write(`${usage}\n`);
				ctx.ui?.notify?.(usage, "error");
				return;
			}

			const current = await readMode(ctx);
			if (current === target) {
				ctx.ui?.notify?.(`目前已是${labelOf(target)}`, "info");
				return;
			}

			// Pi cannot reload while a turn is running. Wait for it to settle so the
			// state change and the resource reload always happen together.
			if (typeof ctx.waitForIdle === "function") await ctx.waitForIdle();

			pi.appendEntry(MODE_ENTRY, { mode: target });
			ctx.ui?.notify?.(`模式已切換：${labelOf(target)}`, "info");
			// Reload re-runs resources_discover so ds-* skills appear/disappear.
			// The session, model, and tool state are preserved by Pi's reload.
			await ctx.reload();
			return;
		},
	});

	pi.registerShortcut("alt+m", {
		description: "切換模式：一般模式 ↔ 深度執行",
		handler: async () => {
			await toggleThroughCommand();
		},
	});
}
