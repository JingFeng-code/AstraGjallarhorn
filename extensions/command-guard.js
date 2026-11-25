// AstraGjallarhorn command guard.
// A deterministic tool_call policy for Pi. It is a heuristic guard, NOT an OS sandbox:
// it reads the command text and tool paths the model supplies, it cannot see what an
// executed script does. Anything it cannot judge and that looks risky is sent to a human.
import os from "node:os";
import path from "node:path";

const POLICY_ENTRY = "astragjallarhorn-guard-policy";
const AUDIT_ENTRY = "astragjallarhorn-guard-audit";
const MODES = ["enforce", "strict", "off"];
const WIN = process.platform === "win32";

const rank = { allow: 0, ask: 1, deny: 2 };
const worse = (a, b) => (rank[b.verdict] > rank[a.verdict] ? b : a);
const allow = () => ({ verdict: "allow", reasons: [] });
const verdict = (v, reason) => ({ verdict: v, reasons: [reason] });

// ---------- path handling ----------
const norm = (p) => (WIN ? p.toLowerCase() : p);
const home = os.homedir();

export function resolvePath(raw, cwd) {
  if (typeof raw !== "string" || raw === "") return undefined;
  let p = raw.trim();
  if (/\$\{?[A-Za-z_(]|`|\$\(/.test(p) && !/^\$\{?(HOME|USERPROFILE)\}?[\\/]/.test(p) && !/^\$env:(USERPROFILE|HOME)[\\/]/i.test(p)) {
    return undefined; // unresolvable expansion
  }
  p = p.replace(/^\$\{?(HOME|USERPROFILE)\}?(?=[\\/]|$)/, home)
    .replace(/^\$env:(USERPROFILE|HOME)/i, home)
    .replace(/^%(USERPROFILE|HOME)%/i, home)
    .replace(/^~(?=[\\/]|$)/, home);
  if (/%[A-Za-z_]+%/.test(p) || /\$env:/i.test(p)) return undefined;
  const msys = p.match(/^\/([a-zA-Z])(?:\/(.*))?$/); // Git Bash /c/Users/...
  if (WIN && msys) p = `${msys[1].toUpperCase()}:\\${(msys[2] ?? "").replace(/\//g, "\\")}`;
  else if (WIN && /^\/(?!\/)/.test(p) && !/^[A-Za-z]:/.test(p)) p = path.win32.resolve("C:\\", p.slice(1)); // POSIX root
  return path.resolve(cwd, p);
}

const inside = (child, root) => {
  const rel = path.relative(norm(path.resolve(root)), norm(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

// ---------- protected locations ----------
const credentialPatterns = [
  /(^|[\\/])auth\.json$/i,
  /(^|[\\/])\.ssh([\\/]|$)/i,
  /(^|[\\/])id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /(^|[\\/])\.aws([\\/]|$)/i,
  /(^|[\\/])\.azure([\\/]|$)/i,
  /(^|[\\/])\.kube[\\/]config$/i,
  /(^|[\\/])\.docker[\\/]config\.json$/i,
  /(^|[\\/])\.(npmrc|netrc|git-credentials|pgpass|pypirc)$/i,
  /(^|[\\/])credentials(\.json)?$/i,
  /(^|[\\/])\.gnupg([\\/]|$)/i,
  /\.(pfx|p12|pem|key|kdbx)$/i,
  /(Login Data|Cookies|Local State)$/i,
  /[\\/]Microsoft[\\/](Credentials|Vault|Protect)([\\/]|$)/i,
];
const dotEnv = /(^|[\\/])\.env(\.[\w.-]+)?$/i;
const dotEnvSafe = /\.(example|sample|template)$/i;

function protectedAgentDirs() {
  const dirs = [".claude", ".codex", ".opencode", ".gemini", ".cursor", ".config/opencode", ".config/herdr-core", ".config/herdr", ".local/share/opencode"]
    .map((d) => path.join(home, d));
  const local = process.env.LOCALAPPDATA;
  if (local) dirs.push(path.join(local, "Programs", "herdr-core"), path.join(local, "herdr-core"), path.join(local, "opencode"));
  const roaming = process.env.APPDATA;
  if (roaming) dirs.push(path.join(roaming, "herdr-core"), path.join(roaming, "opencode"), path.join(roaming, "Claude"));
  return dirs;
}
const projectAgentDirNames = new Set([".claude", ".codex", ".opencode"]);

function piSelfProtected(abs) {
  const piHome = path.join(home, ".pi", "agent");
  const rel = path.relative(norm(piHome), norm(abs));
  if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
  return /^(settings\.json|models\.json|auth\.json|extensions[\\/](command-guard|checkpoint|task-recovery|handoff)\.js|npm[\\/]|install[\\/])/i.test(rel);
}

// paths a model must not touch for writing
function writeProtection(abs) {
  for (const dir of protectedAgentDirs()) if (inside(abs, dir)) return `modifies another agent's configuration (${dir})`;
  if (abs.split(/[\\/]/).some((part) => projectAgentDirNames.has(part.toLowerCase()))) return "modifies another agent's project configuration";
  if (/(^|[\\/])(CLAUDE|AGENTS)\.md$/i.test(abs) && false) return undefined;
  if (piSelfProtected(abs)) return "modifies Pi's own settings or guard extensions";
  if (WIN) {
    const sys = [process.env.SystemRoot, process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.ProgramData].filter(Boolean);
    for (const dir of sys) if (inside(abs, dir)) return `modifies a system location (${dir})`;
  }
  return undefined;
}

function credentialReason(abs) {
  if (credentialPatterns.some((re) => re.test(abs))) return "touches a credential or key file";
  if (dotEnv.test(abs) && !dotEnvSafe.test(abs)) return "touches an .env secrets file";
  return undefined;
}

// ---------- shell parsing ----------
// Splits into simple commands. Returns { segments: [{words, redirects, raw}], substitutions: [string], opaque: bool }
export function parseShell(input) {
  const segments = [];
  const substitutions = [];
  let words = [];
  let redirects = [];
  let cur = "";
  let hasWord = false;
  let opaque = false;
  let expectRedirect = false;
  const push = () => {
    if (hasWord) {
      if (expectRedirect) { redirects.push(cur); expectRedirect = false; }
      else words.push(cur);
    }
    cur = ""; hasWord = false;
  };
  const endSeg = () => {
    push();
    if (words.length || redirects.length) segments.push({ words, redirects });
    words = []; redirects = []; expectRedirect = false;
  };
  const readBalanced = (start, open, close) => {
    let depth = 0;
    for (let i = start; i < input.length; i++) {
      if (input[i] === open) depth++;
      else if (input[i] === close && --depth === 0) return i;
    }
    return -1;
  };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === "'") {
      const end = input.indexOf("'", i + 1);
      if (end < 0) { opaque = true; cur += input.slice(i + 1); i = input.length; } else { cur += input.slice(i + 1, end); i = end; }
      hasWord = true;
    } else if (c === '"') {
      hasWord = true;
      let j = i + 1;
      for (; j < input.length && input[j] !== '"'; j++) {
        if (input[j] === "\\" && j + 1 < input.length && '"$`\\'.includes(input[j + 1]) && !(WIN && input[j + 1] === "\\")) { cur += input[++j]; continue; }
        if (input[j] === "$" && input[j + 1] === "(") {
          const end = readBalanced(j + 1, "(", ")");
          if (end < 0) { opaque = true; break; }
          substitutions.push(input.slice(j + 2, end));
          cur += "$(…)"; j = end; continue;
        }
        if (input[j] === "`") {
          const end = input.indexOf("`", j + 1);
          if (end < 0) { opaque = true; break; }
          substitutions.push(input.slice(j + 1, end)); cur += "`…`"; j = end; continue;
        }
        cur += input[j];
      }
      i = j;
    } else if (c === "\\" && !WIN) {
      cur += input[++i] ?? ""; hasWord = true;
    } else if (c === "`" ) {
      const end = input.indexOf("`", i + 1);
      if (end < 0) { opaque = true; } else { substitutions.push(input.slice(i + 1, end)); cur += "`…`"; hasWord = true; i = end; }
    } else if (c === "$" && input[i + 1] === "(") {
      const end = readBalanced(i + 1, "(", ")");
      if (end < 0) { opaque = true; break; }
      substitutions.push(input.slice(i + 2, end)); cur += "$(…)"; hasWord = true; i = end;
    } else if ((c === "<" || c === ">") && input[i + 1] === "(") {
      const end = readBalanced(i + 1, "(", ")");
      if (end < 0) { opaque = true; break; }
      substitutions.push(input.slice(i + 2, end)); cur += "<(…)"; hasWord = true; i = end;
    } else if (c === ";" || c === "\n" || c === "\r") {
      endSeg();
    } else if (c === "&" && input[i + 1] === "&") { endSeg(); i++; }
    else if (c === "|" ) { endSeg(); if (input[i + 1] === "|" || input[i + 1] === "&") i++; }
    else if (c === "&") {
      if (input[i + 1] === ">" ) { push(); expectRedirect = true; i += input[i + 2] === ">" ? 2 : 1; }
      else if (cur.endsWith(">") || cur.endsWith("<")) { cur += c; hasWord = true; }
      else endSeg();
    } else if (c === ">" || c === "<") {
      // numeric fd prefix like 2>
      if (hasWord && /^\d+$/.test(cur)) { cur = ""; hasWord = false; } else push();
      if (c === ">" && input[i + 1] === ">") i++;
      if (input[i + 1] === "&") { // 2>&1 style: not a file
        i++; while (/[\d-]/.test(input[i + 1] ?? "")) i++;
      } else expectRedirect = true;
    } else if (c === "(" || c === ")") { endSeg(); }
    else if ((c === "{" || c === "}") && (!hasWord) && (/\s|;|^$/.test(input[i + 1] ?? " "))) { endSeg(); }
    else if (/\s/.test(c)) { push(); }
    else { cur += c; hasWord = true; }
  }
  endSeg();
  return { segments, substitutions, opaque };
}

const flagOf = (w) => /^-{1,2}[A-Za-z]/.test(w) || /^\/[A-Za-z]$/.test(w);
const baseName = (w) => path.basename(w.replace(/\\/g, "/")).toLowerCase().replace(/\.(exe|cmd|bat|ps1|com)$/, "");

const rmLike = new Set(["rm", "rmdir", "rd", "del", "erase", "remove-item", "ri", "unlink", "shred"]);
const writeAll = new Set(["mv", "move", "move-item", "mi", "rename-item", "ren", "rn", "mkdir", "md", "touch", "tee", "chmod", "chown", "icacls", "takeown", "truncate", "set-content", "sc", "add-content", "ac", "out-file", "new-item", "ni", "clear-content", "set-itemproperty", "expand-archive", "mklink", "attrib"]);
const copyLike = new Set(["cp", "copy", "copy-item", "cpi", "xcopy", "robocopy", "install", "ln", "rsync", "scp"]);
const shells = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const psShells = new Set(["powershell", "pwsh"]);
const wrappers = new Set(["sudo", "command", "builtin", "exec", "nohup", "time", "nice", "stdbuf", "start", "start-process", "call"]);

function gitVerdict(args) {
  // skip global options
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (["-C", "-c", "--git-dir", "--work-tree", "--namespace"].includes(a)) { rest.push(`@${a}=${args[i + 1] ?? ""}`); i++; continue; }
    if (a.startsWith("--git-dir=") || a.startsWith("--work-tree=")) { rest.push(`@${a}`); continue; }
    if (a.startsWith("-") && rest.filter((r) => !r.startsWith("@")).length === 0) continue;
    rest.push(a);
  }
  const plain = rest.filter((r) => !r.startsWith("@"));
  const sub = plain[0];
  if (rest.some((r) => /\$\(…\)|`…`/.test(r))) return verdict("ask", "git arguments are computed at runtime");
  const tail = plain.slice(1);
  const has = (...flags) => tail.some((t) => flags.includes(t) || flags.some((f) => f.length > 2 && t.startsWith(`${f}=`)));
  const shortFlag = (ch) => tail.some((t) => /^-[a-zA-Z]+$/.test(t) && t.includes(ch));
  const d = (m) => verdict("ask", `destructive git operation: ${m}`);
  switch (sub) {
    case "reset": return has("--hard", "--merge", "--keep") ? d("reset --hard") : allow();
    case "clean": return shortFlag("f") || has("--force") ? d("clean -f") : allow();
    case "checkout":
      if (has("--") && tail.slice(tail.indexOf("--") + 1).length) return d("checkout -- <paths> discards changes");
      if (tail.includes(".") || has("-f", "--force")) return d("checkout . / --force discards changes");
      return allow();
    case "restore": return has("--staged") && !has("--worktree") ? allow() : d("restore discards working tree changes");
    case "switch": return has("--discard-changes", "-f", "--force") ? d("switch --discard-changes") : allow();
    case "push":
      if (has("--force", "-f", "--force-with-lease", "--delete", "-d", "--mirror", "--prune") || tail.some((t) => /^\+|^:/.test(t) && !t.startsWith("::"))) return d("push that rewrites or deletes remote refs");
      return allow();
    case "branch": return shortFlag("D") || has("-D", "--delete", "-d", "--force", "-f") ? d("branch delete/force") : allow();
    case "tag": return has("-d", "--delete", "-f", "--force") ? d("tag delete/force") : allow();
    case "stash": return ["drop", "clear"].includes(tail[0]) ? d(`stash ${tail[0]}`) : allow();
    case "rebase": case "filter-branch": case "filter-repo": case "replace": return d(sub);
    case "reflog": return ["expire", "delete"].includes(tail[0]) ? d("reflog expire/delete") : allow();
    case "gc": return has("--prune=now", "--aggressive") || tail.some((t) => t.startsWith("--prune")) ? d("gc prune") : allow();
    case "prune": return d("prune");
    case "update-ref": return has("-d") ? d("update-ref -d") : allow();
    case "worktree": return ["remove", "prune"].includes(tail[0]) ? d("worktree remove") : allow();
    case "config": return has("--global", "--system") ? verdict("deny", "changes global/system git config") : allow();
    case "rm": return d("git rm");
    default: return allow();
  }
}

const sysDeny = new Set(["reg", "regedit", "setx", "netsh", "sc", "schtasks", "bcdedit", "diskpart", "format", "shutdown", "restart-computer", "stop-computer", "set-executionpolicy", "enable-windowsoptionalfeature", "disable-windowsoptionalfeature", "dism", "new-service", "set-service", "remove-service", "set-mppreference", "add-mppreference", "disable-netadapter", "set-netfirewallrule", "new-netfirewallrule", "netsh", "wmic", "cmdkey", "vaultcmd", "mimikatz", "reg.exe", "fsutil", "manage-bde", "gpupdate", "secedit", "auditpol", "wevtutil", "vssadmin", "bcdboot", "mountvol", "cipher", "set-itemproperty-hklm", "launchctl", "systemctl", "defaults", "scutil"]);

function globalInstall(cmd, args) {
  const joined = args.join(" ");
  const g = args.some((a) => ["-g", "--global", "--location=global", "--location", "global"].includes(a)) || /\s-g(\s|$)/.test(` ${joined} `);
  if (["npm", "pnpm", "yarn", "bun"].includes(cmd) && g && args.some((a) => /^(i|install|add|remove|uninstall|rm|update|up|link|ln|rebuild)$/.test(a))) return "global package install/modify";
  if (cmd === "yarn" && args[0] === "global") return "global package install/modify";
  if (["pip", "pip3"].includes(cmd) && args[0] === "install" && !process.env.VIRTUAL_ENV && !args.includes("--target")) return "pip install into the global/user Python";
  if (cmd === "python" || cmd === "python3" || cmd === "py") { if (args[0] === "-m" && args[1] === "pip" && args[2] === "install") return "pip install into the global/user Python"; }
  if (cmd === "dotnet" && args[0] === "tool" && ["install", "update", "uninstall"].includes(args[1]) && g) return "dotnet global tool change";
  if (cmd === "dotnet" && args[0] === "workload") return "dotnet workload change";
  if (["choco", "winget", "scoop", "brew", "apt", "apt-get", "yum", "dnf", "pacman", "msiexec", "cinst"].includes(cmd)) return "system package manager";
  if (cmd === "cargo" && args[0] === "install") return "cargo install into the user toolchain";
  if (cmd === "go" && args[0] === "install") return "go install into the user toolchain";
  if (cmd === "gem" && args[0] === "install") return "gem install";
  if (cmd === "install-module" || cmd === "install-package" || cmd === "install-script") return "PowerShell global module install";
  if (cmd === "pi" && ["install", "remove", "update", "uninstall"].includes(args[0])) return "Pi package change";
  if (cmd === "ollama" && ["pull", "rm", "create", "cp", "push"].includes(args[0])) return "Ollama global model change";
  return undefined;
}

// Analyze a shell command string. `ctx` = { cwd, roots }
export function analyzeCommand(command, ctx, depth = 0) {
  let result = allow();
  if (typeof command !== "string" || command.trim() === "") return result;
  if (depth > 4) return verdict("ask", "command nesting too deep to analyze");
  const add = (v, reason) => { result = worse(result, verdict(v, reason)); };
  const parsed = parseShell(command);
  if (parsed.opaque) add("ask", "unbalanced quotes or substitution: cannot analyze reliably");
  for (const sub of parsed.substitutions) result = worse(result, analyzeCommand(sub, ctx, depth + 1));
  const state = { cwd: ctx.cwd, cwdKnown: true };

  const checkWriteTarget = (raw, why) => {
    const abs = state.cwdKnown ? resolvePath(raw, state.cwd) : undefined;
    if (!abs) { add("ask", `${why}: target "${raw}" cannot be resolved statically`); return undefined; }
    const prot = writeProtection(abs);
    if (prot) add("deny", `${why}: ${prot} ("${raw}")`);
    else if (!ctx.roots.some((r) => inside(abs, r))) add("deny", `${why}: "${raw}" is outside the authorized directories`);
    return abs;
  };
  const checkAny = (raw) => {
    const abs = state.cwdKnown ? resolvePath(raw, state.cwd) : undefined;
    if (!abs) return;
    const cred = credentialReason(abs);
    if (cred) add(inside(abs, ctx.cwd) && dotEnv.test(abs) && !/auth\.json/i.test(abs) ? "ask" : "deny", `${cred} ("${raw}")`);
  };

  for (const seg of parsed.segments) {
    for (const r of seg.redirects) {
      if (/^(\/dev\/null|nul|\$null)$/i.test(r)) continue;
      checkWriteTarget(r, "output redirection");
      checkAny(r);
    }
    let words = [...seg.words];
    // strip leading VAR=value assignments and wrappers
    while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
    while (words.length && (wrappers.has(baseName(words[0])) || baseName(words[0]) === "env")) {
      const w = baseName(words[0]); words.shift();
      if (w === "env") while (words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]) || flagOf(words[0]))) words.shift();
      if (w === "start-process") {
        while (words.length && flagOf(words[0]) && !/^-(argumentlist|args)$/i.test(words[0])) words.shift();
        const inner = words.filter((x) => !/^-(argumentlist|filepath|nonewwindow|wait|passthru|windowstyle|verb)$/i.test(x)).join(" ");
        result = worse(result, analyzeCommand(inner, { ...ctx, cwd: state.cwd }, depth + 1));
        words = [];
        break;
      }
    }
    if (words.length === 0) continue;
    if (baseName(words[0]) === "timeout" && words.length > 2) words.splice(0, /^\d/.test(words[1]) ? 2 : 1);
    if (words.length === 0) continue;
    let cmd = baseName(words[0]);
    let args = words.slice(1);
    const nonFlags = args.filter((a) => !flagOf(a));
    for (const a of args) if (!flagOf(a) || a.includes("=")) checkAny(a.includes("=") && flagOf(a) ? a.split("=").slice(1).join("=") : a);

    // dynamic command word
    if (/[$`]/.test(words[0]) && !/^\$\(|^\$[A-Za-z_]/.test("")) {
      add("ask", `command name is computed at runtime ("${words[0]}")`);
      continue;
    }

    if (sysDeny.has(cmd) || (cmd === "reg" )) {
      if (!(cmd === "reg" && ["query", "export"].includes((args[0] ?? "").toLowerCase()))) add("deny", `system configuration command: ${cmd}`);
      continue;
    }
    if (cmd === "cd" || cmd === "pushd" || cmd === "set-location" || cmd === "sl" || cmd === "chdir") {
      const target = nonFlags[0];
      const abs = target && state.cwdKnown ? resolvePath(target, state.cwd) : undefined;
      if (abs) state.cwd = abs; else state.cwdKnown = target === undefined ? state.cwdKnown : false;
      continue;
    }
    if (cmd === "git") {
      let g = gitVerdict(args);
      result = worse(result, g);
      const cIdx = args.indexOf("-C");
      if (cIdx >= 0 && args[cIdx + 1]) {
        const abs = state.cwdKnown ? resolvePath(args[cIdx + 1], state.cwd) : undefined;
        const mutating = !["status", "diff", "log", "show", "rev-parse", "ls-files", "branch", "cat-file", "blame", "describe", "grep", "ls-tree", "remote", "rev-list", "shortlog", "config"].includes(args.filter((a, i) => i !== cIdx && i !== cIdx + 1 && !a.startsWith("-"))[0]);
        if (!abs) add("ask", "git -C target cannot be resolved");
        else if (mutating && !ctx.roots.some((r) => inside(abs, r))) add("deny", `git -C ${args[cIdx + 1]} modifies a repository outside the authorized directories`);
      }
      continue;
    }
    const gi = globalInstall(cmd, args);
    if (gi) { add("ask", `${gi}: "${cmd} ${args.slice(0, 3).join(" ")}"`); }

    // indirect execution
    if (cmd === "eval") { add("ask", "eval executes computed text"); continue; }
    if (cmd === "xargs") {
      const rest = args.filter((a) => !flagOf(a) || false);
      if (rest.length) result = worse(result, analyzeCommand(rest.join(" "), ctx, depth + 1));
      add("ask", "xargs runs a command on computed arguments");
      continue;
    }
    if (shells.has(cmd) || cmd === "busybox") {
      const ci = args.findIndex((a) => /^-[a-z]*c$/.test(a));
      if (ci >= 0 && args[ci + 1] !== undefined) result = worse(result, analyzeCommand(args[ci + 1], ctx, depth + 1));
      else if (args.length === 0) add("ask", "interactive/stdin shell");
      continue;
    }
    if (cmd === "cmd") {
      const ci = args.findIndex((a) => /^\/[ck]$/i.test(a));
      if (ci >= 0) result = worse(result, analyzeCommand(args.slice(ci + 1).join(" "), ctx, depth + 1));
      continue;
    }
    if (psShells.has(cmd)) {
      const enc = args.findIndex((a) => /^-(e|ec|enc|encodedcommand)$/i.test(a));
      if (enc >= 0) { add("ask", "PowerShell -EncodedCommand cannot be inspected"); continue; }
      const ci = args.findIndex((a) => /^-(c|command)$/i.test(a));
      if (ci >= 0) result = worse(result, analyzeCommand(args.slice(ci + 1).join(" "), ctx, depth + 1));
      continue;
    }
    if (cmd === "iex" || cmd === "invoke-expression") { add("ask", "Invoke-Expression executes computed text"); continue; }
    if (cmd === "invoke-command" || cmd === "icm") { add("ask", "Invoke-Command"); continue; }
    if (["node", "nodejs", "python", "python3", "py", "perl", "ruby", "deno", "bun"].includes(cmd)) {
      const ei = args.findIndex((a) => /^(-e|-c|--eval|-p|--print)$/.test(a));
      if (ei >= 0) {
        const code = args[ei + 1] ?? "";
        if (/child_process|\bexec\w*\(|spawn|system\(|subprocess|os\.system|rmSync|rmdirSync|rmtree|unlink|rm -rf|Remove-Item|writeFile|appendFile|\bopen\(|fetch\(|http/.test(code)) add("ask", `inline ${cmd} code performs process/file/network operations`);
      }
    }
    if ((cmd === "curl" || cmd === "wget" || cmd === "invoke-webrequest" || cmd === "iwr" || cmd === "invoke-restmethod" || cmd === "irm") && words.length) {
      // pipe-to-shell is detected below via segment sequence; uploads of local files need approval
      if (args.some((a) => /^(-d|--data\S*|-F|--form|-T|--upload-file|-InFile|-Body)$/i.test(a) || /^@/.test(a))) add("ask", "network upload of local data");
      const oi = args.findIndex((a) => /^(-o|--output|-OutFile)$/i.test(a));
      if (oi >= 0 && args[oi + 1]) checkWriteTarget(args[oi + 1], `${cmd} output`);
    }

    // file-system mutation
    if (rmLike.has(cmd)) {
      const recursive = args.some((a) => /^-[a-z]*r[a-z]*$/i.test(a) || /^-recurse$/i.test(a) || /^\/s$/i.test(a) || a === "--recursive");
      const targets = nonFlags.filter((a) => !/^(-|\/)(path|literalpath|force|recurse|confirm)$/i.test(a));
      if (targets.length === 0) continue;
      const wildcard = targets.some((t) => /[*?]/.test(t));
      for (const t of targets) {
        const abs = checkWriteTarget(t, `${cmd}`);
        if (abs) {
          const root = path.parse(abs).root;
          if (abs === root || norm(abs) === norm(home) || ctx.roots.some((r) => norm(path.resolve(r)) === norm(abs))) add("deny", `${cmd} would remove a protected root ("${t}")`);
          else if (norm(abs) === norm(ctx.cwd)) add("deny", "deleting the working directory itself");
        }
      }
      if (recursive || wildcard || targets.length > 5) add("ask", `bulk delete (${recursive ? "recursive " : ""}${wildcard ? "wildcard " : ""}${targets.length} target(s)): ${cmd} ${targets.slice(0, 4).join(" ")}`);
      continue;
    }
    if (cmd === "find" && args.includes("-delete") || (cmd === "find" && args.some((a) => a === "-exec") && /\brm\b|\bdel\b/.test(args.join(" ")))) { add("ask", "find with delete/exec rm"); }
    if (cmd === "sed" && args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith("--in-place"))) {
      for (const t of nonFlags.slice(1)) checkWriteTarget(t, "sed -i");
    }
    if (cmd === "dd") { for (const a of args) if (a.startsWith("of=")) checkWriteTarget(a.slice(3), "dd of="); }
    if (copyLike.has(cmd)) {
      const t = nonFlags[nonFlags.length - 1];
      if (t && nonFlags.length >= 2) checkWriteTarget(t, cmd);
      else if (cmd === "copy-item" || cmd === "cpi") for (const a of nonFlags) checkWriteTarget(a, cmd);
      continue;
    }
    if (writeAll.has(cmd)) {
      if (cmd === "set-itemproperty" && args.some((a) => /^hk(lm|cu|cr):?/i.test(a))) { add("deny", "registry write"); continue; }
      const skip = cmd === "chmod" || cmd === "chown" ? 1 : 0;
      for (const t of nonFlags.slice(skip)) checkWriteTarget(t, cmd);
      continue;
    }
  }

  // pipe-to-interpreter: curl ... | sh
  const compact = parsed.segments.map((s) => s.words.map(baseName));
  for (let i = 1; i < compact.length; i++) {
    const prev = compact[i - 1][0];
    const head = compact[i][0];
    if (["curl", "wget", "invoke-webrequest", "iwr", "invoke-restmethod", "irm"].includes(prev) && (shells.has(head) || psShells.has(head) || head === "iex" || head === "invoke-expression" || head === "python" || head === "node")) {
      // Only if they were actually joined by a pipe
      if (/\|/.test(command)) add("deny", "downloads and executes remote code (pipe to interpreter)");
    }
  }
  return result;
}

// Analyze file tools.
export function analyzeFileTool(toolName, input, ctx) {
  const raw = input?.path ?? input?.file_path ?? input?.filePath;
  if (typeof raw !== "string") return allow();
  const abs = resolvePath(raw, ctx.cwd);
  if (!abs) return verdict("ask", `${toolName}: path "${raw}" cannot be resolved`);
  const cred = credentialReason(abs);
  if (cred) return verdict(inside(abs, ctx.cwd) && dotEnv.test(abs) ? "ask" : "deny", `${toolName} ${cred} ("${raw}")`);
  if (toolName === "read" || toolName === "grep" || toolName === "find" || toolName === "ls") return allow();
  const prot = writeProtection(abs);
  if (prot) return verdict("deny", `${toolName} ${prot} ("${raw}")`);
  if (!ctx.roots.some((r) => inside(abs, r))) return verdict("deny", `${toolName} "${raw}" is outside the authorized directories`);
  return allow();
}

const writeTools = new Set(["write", "edit", "multiedit", "hashline_replace", "notebook_edit"]);

export default function (pi) {
  let mode = "enforce";
  let extraRoots = [];
  const policyFromEnv = process.env.ASTRA_GUARD_MODE;
  const readPolicy = (ctx) => {
    const entry = ctx.sessionManager.getEntries().findLast((item) => item.type === "custom" && item.customType === POLICY_ENTRY);
    mode = MODES.includes(entry?.data?.mode) ? entry.data.mode : MODES.includes(policyFromEnv) ? policyFromEnv : "enforce";
    extraRoots = Array.isArray(entry?.data?.roots) ? entry.data.roots : [];
  };
  const save = () => pi.appendEntry(POLICY_ENTRY, { mode, roots: extraRoots });
  const rootsFor = (ctx) => {
    const roots = [ctx.cwd, ...extraRoots];
    for (const extra of (process.env.ASTRA_GUARD_ROOTS ?? "").split(path.delimiter).filter(Boolean)) roots.push(extra);
    return roots;
  };

  pi.registerCommand("guard", {
    description: "Command guard. Usage: status|enforce|strict|off|allow <dir>|clear",
    async handler(args, ctx) {
      const [option = "status", ...rest] = args.trim().split(/\s+/);
      if (MODES.includes(option)) { mode = option; save(); }
      else if (option === "allow" && rest.length) {
        const abs = resolvePath(rest.join(" "), ctx.cwd);
        if (!abs) { ctx.ui.notify("Cannot resolve that directory.", "error"); return; }
        extraRoots = [...new Set([...extraRoots, abs])]; save();
      } else if (option === "clear") { extraRoots = []; save(); }
      else if (option !== "status") { ctx.ui.notify("Usage: /guard status|enforce|strict|off|allow <dir>|clear", "error"); return; }
      ctx.ui.notify(`Guard ${mode}. Authorized: ${rootsFor(ctx).join(", ")}. Heuristic policy, not an OS sandbox.`, "info");
    },
  });

  pi.on("session_start", (_event, ctx) => readPolicy(ctx));

  pi.on("tool_call", async (event, ctx) => {
    if (mode === "off") return;
    const policyCtx = { cwd: ctx.cwd, roots: rootsFor(ctx) };
    let result = allow();
    if (event.toolName === "bash") result = analyzeCommand(event.input?.command, policyCtx);
    else if (writeTools.has(event.toolName) || ["read", "grep", "find", "ls"].includes(event.toolName)) result = analyzeFileTool(event.toolName, event.input, policyCtx);
    if (result.verdict === "allow") return;
    const reason = result.reasons.join("; ");
    let final = result.verdict;
    if (final === "ask" && mode === "strict") final = "deny";
    if (final === "ask") {
      if (!ctx.hasUI) final = "deny";
      else {
        const ok = await ctx.ui.confirm("Command guard", `${event.toolName}: ${reason}\n\nAllow this call?`);
        if (!ok) final = "deny"; else final = "approved";
      }
    }
    pi.appendEntry(AUDIT_ENTRY, { tool: event.toolName, verdict: final, reason, at: new Date().toISOString() });
    if (final === "approved") return;
    return { block: true, reason: `Blocked by command guard: ${reason}. Do not retry this call; choose a safer approach or ask the user.` };
  });
}
