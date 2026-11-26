// AstraGjallarhorn diff review.
// Gives a review-only model a single read-only tool that fetches staged diff, unstaged diff,
// untracked files and a scope report. It runs a fixed set of git read commands, accepts no
// free-form arguments, and proves the work tree did not change by fingerprinting it before and after.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

const MAX_DIFF = 12_000;
const MAX_RESPONSE = 30_000;
export function boundedText(text, limit=MAX_RESPONSE) {
  const suffix="\n[truncated; use smaller diff scope or read the relevant files directly]";
  return text.length<=limit?text:text.slice(0,limit-suffix.length)+suffix;
}
const TEST_PATH = /(^|[\\/])(tests?|__tests__|spec|e2e)([\\/]|$)|\.(test|spec)\.[cm]?[jt]sx?$|\.tests?\.|tests?\.cs$|test_.*\.py$|.*_test\.(go|py)$/i;
const DOC_PATH = /\.(md|txt|rst)$|^docs?[\\/]/i;
const SOURCE_PATH = /\.([cm]?[jt]sx?|vue|cs|py|go|rs|java|sql|ps1|sh|rb)$/i;

function git(cwd, args, { binary = false } = {}) {
  return new Promise((resolve, reject) => {
    execFile("git", ["--no-pager", "-c", "core.quotepath=false", ...args], { cwd, maxBuffer: 128 * 1024 * 1024, windowsHide: true, encoding: binary ? "buffer" : "utf8" },
      (error, stdout, stderr) => (error ? reject(Object.assign(error, { stderr: String(stderr) })) : resolve(stdout)));
  });
}

export async function repoRoot(cwd) {
  return path.resolve((await git(cwd, ["rev-parse", "--show-toplevel"])).trim());
}

// Read-only fingerprint of everything a review must not change.
export async function fingerprint(root) {
  const hash = createHash("sha256");
  hash.update(await git(root, ["status", "--porcelain=v2", "-z", "--untracked-files=all"]));
  hash.update(await git(root, ["diff", "HEAD", "--binary", "--no-ext-diff"], { binary: true }).catch(() => ""));
  const untracked = (await git(root, ["ls-files", "-z", "-o", "--exclude-standard"])).split("\0").filter(Boolean);
  for (const file of untracked) hash.update(`${file}\0${(await git(root, ["hash-object", "--no-filters", "--", file]).catch(() => "")).trim()}\0`);
  hash.update((await git(root, ["rev-parse", "HEAD"]).catch(() => "unborn")).trim());
  hash.update((await git(root, ["stash", "list"])).toString());
  return hash.digest("hex");
}

export function scopeReport({ staged, unstaged, untracked }) {
  const all = new Map();
  for (const [label, list] of [["staged", staged], ["unstaged", unstaged], ["untracked", untracked]]) {
    for (const file of list) all.set(file, [...(all.get(file) ?? []), label]);
  }
  const files = [...all.keys()];
  const tests = files.filter((f) => TEST_PATH.test(f));
  const docs = files.filter((f) => DOC_PATH.test(f) && !TEST_PATH.test(f));
  const source = files.filter((f) => SOURCE_PATH.test(f) && !TEST_PATH.test(f) && !DOC_PATH.test(f));
  const other = files.filter((f) => !tests.includes(f) && !docs.includes(f) && !source.includes(f));
  const flags = [];
  if (source.length && !tests.length) flags.push(`REGRESSION-TEST GAP: ${source.length} source file(s) changed and no test file changed.`);
  const both = [...all.entries()].filter(([, v]) => v.includes("staged") && v.includes("unstaged")).map(([f]) => f);
  if (both.length) flags.push(`PARTIALLY STAGED: ${both.join(", ")} has staged and unstaged edits; review both diffs.`);
  if (untracked.length) flags.push(`UNTRACKED: ${untracked.length} new file(s) are not in any diff; read them.`);
  return { files: Object.fromEntries(all), counts: { source: source.length, tests: tests.length, docs: docs.length, other: other.length }, flags };
}

export async function collectDiff(root, scope = "all") {
  const names = async (args) => (await git(root, args)).split("\0").filter(Boolean);
  const staged = await names(["diff", "--cached", "--name-only", "-z", "--no-ext-diff"]);
  const unstaged = await names(["diff", "--name-only", "-z", "--no-ext-diff"]);
  const untracked = await names(["ls-files", "-z", "-o", "--exclude-standard"]);
  const report = scopeReport({ staged, unstaged, untracked });
  const section = async (title, args) => {
    let text = await git(root, [...args, "--no-ext-diff", "--no-textconv"]);
    const truncated = text.length > MAX_DIFF;
    if (truncated) text = boundedText(text, MAX_DIFF);
    return `## ${title}\n${text.trim() || "(empty)"}`;
  };
  const parts = [`# Review scope\n${JSON.stringify(report.counts)}\n${report.flags.map((f) => `- ${f}`).join("\n") || "- no scope flags"}\nFiles: ${Object.entries(report.files).map(([f, v]) => `${f} [${v.join("+")}]`).join(", ") || "(none)"}`];
  if (scope === "staged" || scope === "all") parts.push(await section("Staged diff (git diff --cached)", ["diff", "--cached"]));
  if (scope === "unstaged" || scope === "all") parts.push(await section("Unstaged diff (git diff)", ["diff"]));
  if (scope === "stat") parts.push(await section("Stat", ["diff", "HEAD", "--stat"]));
  if (scope === "all" && untracked.length) parts.push(`## Untracked files\n${untracked.join("\n")}`);
  return { text: boundedText(parts.join("\n\n")), report };
}

export default async function (pi) {
  const { Type } = await import("typebox");
  pi.registerTool({
    name: "review_diff",
    label: "Review diff",
    description: "Read-only: returns the staged diff, unstaged diff, untracked file list and a scope report (changed files, missing regression tests) for the current repository. Never modifies anything.",
    promptSnippet: "Fetch staged/unstaged diff and a review scope report (read-only)",
    promptGuidelines: [
      "Use review_diff once at the start of a code review to get the staged and unstaged diffs instead of guessing; then use read for surrounding code and architecture documents such as AGENTS.md.",
    ],
    parameters: Type.Object({
      scope: Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("staged"), Type.Literal("unstaged"), Type.Literal("stat")], { description: "Which diff to return. Default all." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const root = await repoRoot(ctx.cwd).catch(() => undefined);
      if (!root) return { content: [{ type: "text", text: "Not inside a git work tree." }], details: {}, isError: true };
      const before = await fingerprint(root);
      const { text, report } = await collectDiff(root, params.scope ?? "all");
      const after = await fingerprint(root);
      const unchanged = before === after;
      return {
        content: [{ type: "text", text: `${text}\n\n(work tree fingerprint ${unchanged ? "unchanged" : "CHANGED DURING REVIEW"}: ${after.slice(0, 12)})` }],
        details: { fingerprint: after, unchanged, flags: report.flags.slice(0, 10).map(f=>boundedText(f,1000)), flagsTruncated: report.flags.length>10 || report.flags.some(f=>f.length>1000) },
        isError: !unchanged,
      };
    },
  });

  let restoreTo;
  pi.on("agent_end", () => { if (restoreTo) { pi.setActiveTools(restoreTo); restoreTo = undefined; } });

  pi.registerCommand("review-diff", {
    description: "Review the current git changes with the read-only review_diff tool. Usage: [focus]",
    async handler(args, ctx) {
      const focus = args.trim() || "correctness, security, error handling, missing regression tests, architecture rule violations";
      if (!pi.getAllTools().some((t) => t.name === "review_diff")) { ctx.ui.notify("review_diff tool is unavailable.", "error"); return; }
      const profile = pi.getActiveTools();
      const reviewTools = ["read", "grep", "find", "ls", "review_diff"].filter((t) => pi.getAllTools().some((x) => x.name === t));
      pi.setActiveTools(reviewTools);
      restoreTo = profile;
      pi.sendUserMessage(`Review the uncommitted changes. Call review_diff first, read any surrounding files and the project's AGENTS.md or architecture notes you need, then report findings ordered by severity with file:line, missing regression tests, and architecture violations. Focus: ${focus}. Do not modify anything.`);
    },
  });
}
