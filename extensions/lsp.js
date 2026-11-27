// AstraGjallarhorn LSP bridge.
// Gives Pi models semantic diagnostics, definitions and references from real language servers
// (TypeScript via typescript-language-server, C# via Microsoft's Roslyn language server).
// Design rules: servers are discovered locally and never downloaded; documents are re-synced
// from disk on every call so edits made by any tool are visible; "clean" is only reported when
// the server positively returned an empty report for the current document version, otherwise
// the answer is "inconclusive"; every server process is terminated on shutdown.
import { spawn, execFile } from "node:child_process";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WIN = process.platform === "win32";
const agentRoot = () => process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
const norm = (p) => (WIN ? path.resolve(p).toLowerCase() : path.resolve(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const canonical = (p) => { try { return realpathSync.native(p); } catch { return p; } };
export const toUri = (file) => pathToFileURL(canonical(file)).href;
export const fromUri = (uri) => fileURLToPath(uri);
const uriKey = (uri) => { try { return norm(fromUri(uri)); } catch { return uri; } };

const LANGUAGE_BY_EXT = {
  ".ts": ["typescript", "typescript"], ".mts": ["typescript", "typescript"], ".cts": ["typescript", "typescript"],
  ".tsx": ["typescript", "typescriptreact"], ".js": ["typescript", "javascript"], ".mjs": ["typescript", "javascript"], ".cjs": ["typescript", "javascript"], ".jsx": ["typescript", "javascriptreact"],
  ".cs": ["csharp", "csharp"],
};
export function languageFor(file) { return LANGUAGE_BY_EXT[path.extname(file).toLowerCase()]; }

export function dedupe(items) {
  const seen = new Set();
  return items.filter((d) => { const k = JSON.stringify([d.range, d.code, d.message, d.severity]); if (seen.has(k)) return false; seen.add(k); return true; });
}

// ---------------- JSON-RPC client ----------------
export class LspClient {
  constructor({ command, args = [], cwd, env = {}, rootUri, serverRequests = {}, label = "lsp" }) {
    this.label = label;
    this.rootUri = rootUri;
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = Buffer.alloc(0);
    this.docs = new Map(); // uri -> { version, text }
    this.published = new Map(); // uri -> { version, diagnostics, seq }
    this.seq = 0;
    this.logs = [];
    this.registrations = [];
    this.flags = { projectsReady: false };
    this.exited = false;
    this.handlers = serverRequests;
    this.child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.exitPromise = new Promise((resolve) => this.child.once("exit", (code) => { this.exited = true; this.rejectAll(new Error(`${label} exited (${code})`)); resolve(code); }));
    this.child.on("error", (error) => { this.exited = true; this.rejectAll(error); });
    this.child.stdout.on("data", (chunk) => this.onData(chunk));
    this.child.stderr.on("data", (chunk) => this.log(String(chunk).trim()));
    this.child.stdin.on("error", () => {});
  }
  log(line) { if (line) { this.logs.push(line.slice(0, 300)); if (this.logs.length > 60) this.logs.shift(); } }
  rejectAll(error) { for (const p of this.pending.values()) p.reject(error); this.pending.clear(); }
  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const match = /Content-Length:\s*(\d+)/i.exec(this.buffer.subarray(0, headerEnd).toString("ascii"));
      if (!match) { this.buffer = this.buffer.subarray(headerEnd + 4); continue; }
      const length = Number(match[1]);
      if (this.buffer.length < headerEnd + 4 + length) return;
      const body = this.buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString("utf8");
      this.buffer = this.buffer.subarray(headerEnd + 4 + length);
      let message;
      try { message = JSON.parse(body); } catch { continue; }
      this.onMessage(message);
    }
  }
  write(message) {
    if (this.exited) return;
    const body = Buffer.from(JSON.stringify(message), "utf8");
    this.child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]));
  }
  request(method, params, timeout = 30000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${this.label} ${method} timed out after ${timeout} ms`)); }, timeout);
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }
  notify(method, params) { this.write({ jsonrpc: "2.0", method, params }); }
  async onMessage(message) {
    if (message.id !== undefined && (message.result !== undefined || message.error) && !message.method) {
      const p = this.pending.get(message.id);
      if (!p) return;
      this.pending.delete(message.id);
      message.error ? p.reject(Object.assign(new Error(message.error.message), { code: message.error.code })) : p.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) { // request from the server
      let result = null;
      try {
        if (message.method === "workspace/configuration") result = (message.params.items ?? []).map((item) => this.handlers.configuration?.(item) ?? null);
        else if (message.method === "workspace/workspaceFolders") result = [{ uri: this.rootUri, name: path.basename(fromUri(this.rootUri)) }];
        else if (message.method === "client/registerCapability") { for (const r of message.params.registrations ?? []) this.registrations.push(r); }
        else if (message.method === "window/showDocument") result = { success: false };
        else if (["client/unregisterCapability", "window/workDoneProgress/create", "window/showMessageRequest", "workspace/diagnostic/refresh", "workspace/semanticTokens/refresh", "workspace/inlayHint/refresh", "workspace/codeLens/refresh"].includes(message.method)) result = null;
        else { this.write({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } }); return; }
      } catch (error) { this.write({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: String(error.message) } }); return; }
      this.write({ jsonrpc: "2.0", id: message.id, result });
      return;
    }
    switch (message.method) {
      case "textDocument/publishDiagnostics": {
        const p = message.params;
        this.published.set(uriKey(p.uri), { version: p.version, diagnostics: p.diagnostics ?? [], seq: ++this.seq });
        this.onPublish?.(p.uri);
        break;
      }
      case "window/logMessage": case "window/showMessage": this.log(message.params?.message ?? ""); break;
      case "workspace/projectInitializationComplete": this.flags.projectsReady = true; break;
      default: break;
    }
  }
  async initialize({ initializationOptions, capabilities } = {}) {
    const result = await this.request("initialize", {
      processId: process.pid, clientInfo: { name: "astra-gjallarhorn-lsp", version: "0.2.0" }, rootUri: this.rootUri,
      workspaceFolders: [{ uri: this.rootUri, name: path.basename(fromUri(this.rootUri)) }],
      initializationOptions,
      capabilities: capabilities ?? {
        workspace: { configuration: true, workspaceFolders: true, didChangeWatchedFiles: { dynamicRegistration: false }, diagnostics: { refreshSupport: false } },
        window: { workDoneProgress: false },
        textDocument: {
          synchronization: { didSave: true, dynamicRegistration: false },
          publishDiagnostics: { versionSupport: true },
          diagnostic: { dynamicRegistration: true, relatedDocumentSupport: false },
          definition: { linkSupport: false }, references: {}, hover: { contentFormat: ["plaintext"] },
        },
      },
    }, 60000);
    this.serverCapabilities = result?.capabilities ?? {};
    this.notify("initialized", {});
    return result;
  }
  // Make the server's view of `file` equal to the bytes on disk. Returns { uri, version, changed }.
  async sync(file, languageId) {
    file = canonical(file);
    const uri = toUri(file);
    const text = await readFile(file, "utf8");
    const known = this.docs.get(uri);
    if (!known) {
      this.docs.set(uri, { version: 1, text });
      this.notify("textDocument/didOpen", { textDocument: { uri, languageId, version: 1, text } });
      return { uri, version: 1, changed: true };
    }
    if (known.text === text) return { uri, version: known.version, changed: false };
    known.version += 1; known.text = text;
    this.notify("textDocument/didChange", { textDocument: { uri, version: known.version }, contentChanges: [{ text }] });
    this.notify("textDocument/didSave", { textDocument: { uri }, text });
    this.notify("workspace/didChangeWatchedFiles", { changes: [{ uri, type: 2 }] });
    return { uri, version: known.version, changed: true };
  }
  async close(file) {
    const uri = toUri(file);
    if (this.docs.delete(uri)) this.notify("textDocument/didClose", { textDocument: { uri } });
  }
  pullIdentifiers() {
    const ids = this.registrations.filter((r) => r.method === "textDocument/diagnostic").map((r) => r.registerOptions?.identifier ?? null);
    return ids.length ? [...new Set(ids)] : [null];
  }
  async diagnose(file, languageId, { timeout = 20000, settle = 1500 } = {}) {
    let { uri, version } = await this.sync(file, languageId);
    const pull = this.serverCapabilities.diagnosticProvider || this.registrations.some((r) => r.method === "textDocument/diagnostic");
    if (pull) {
      const items = [];
      let complete = true;
      for (const identifier of this.pullIdentifiers()) {
        try {
          const report = await this.request("textDocument/diagnostic", { textDocument: { uri }, ...(identifier ? { identifier } : {}) }, timeout);
          if (report?.kind === "full" && Array.isArray(report.items)) items.push(...report.items);
          // This client sends no previousResultId and cannot reuse an unchanged report.
          else complete = false;
        } catch (error) { complete = false; this.log(`pull diagnostics failed: ${error.message}`); }
      }
      if (!complete) return { source: "pull", version, diagnostics: undefined };
      return { source: "pull", version, diagnostics: dedupe(items) };
    }
    // Push model: wait for a publish that covers this version (or any publish after the sync).
    let startSeq = this.seq;
    let wanted = version;
    const started = Date.now();
    const deadline = started + timeout;
    let nudged = false;
    let hit;
    while (Date.now() < deadline) {
      const rec = this.published.get(uriKey(uri));
      if (rec && (rec.version === wanted || (rec.version === undefined && rec.seq > startSeq))) { hit = rec; break; }
      if (!nudged && Date.now() - started > timeout / 3) {
        // A slow or debouncing server may have missed the change: resend identical text as a new version once.
        nudged = true;
        const doc = this.docs.get(uri);
        doc.version += 1; wanted = doc.version; startSeq = this.seq;
        this.notify("textDocument/didChange", { textDocument: { uri, version: doc.version }, contentChanges: [{ text: doc.text }] });
        this.notify("textDocument/didSave", { textDocument: { uri }, text: doc.text });
      }
      await sleep(50);
    }
    version = wanted;
    if (!hit) return { source: "push", version, diagnostics: undefined };
    await sleep(settle); // later passes (semantic after syntactic) arrive as separate publishes
    const last = this.published.get(uriKey(uri));
    const final = last && (last.version === version || last.version === undefined) ? last : hit;
    return { source: "push", version, diagnostics: final.diagnostics };
  }
  async dispose() {
    if (!this.exited) {
      try { await this.request("shutdown", undefined, 3000); this.notify("exit", undefined); } catch { /* fall through to kill */ }
      await Promise.race([this.exitPromise, sleep(3000)]);
    }
    if (!this.exited) await killTree(this.child.pid);
    await Promise.race([this.exitPromise, sleep(2000)]);
    this.exited = true;
  }
}

export function killTree(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve();
    if (WIN) execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve());
    else { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } resolve(); }
  });
}

// ---------------- server discovery (local only, never downloads) ----------------
async function newestRoslyn() {
  if (process.env.ASTRA_ROSLYN_LS && existsSync(process.env.ASTRA_ROSLYN_LS)) return process.env.ASTRA_ROSLYN_LS;
  const extDir = path.join(os.homedir(), ".vscode", "extensions");
  let names = [];
  try { names = (await readdir(extDir)).filter((n) => n.startsWith("ms-dotnettools.csharp-")); } catch { return undefined; }
  names.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const name of names) {
    const dll = path.join(extDir, name, ".roslyn", "Microsoft.CodeAnalysis.LanguageServer.dll");
    if (existsSync(dll)) return dll;
  }
  return undefined;
}

export async function resolveServer(language, root) {
  if (language === "typescript") {
    const candidates = [process.env.ASTRA_TSLS, path.join(agentRoot(), "lsp", "node_modules", "typescript-language-server", "lib", "cli.mjs")].filter(Boolean);
    const cli = candidates.find((c) => existsSync(c));
    if (!cli) return { error: `TypeScript language server is not installed. Install the pinned version (no automatic download): npm install --prefix "${path.join(agentRoot(), "lsp")}" --ignore-scripts --save-exact typescript@5.9.3 typescript-language-server@6.1.0` };
    const own = path.join(path.dirname(cli), "..", "..", "typescript", "lib", "tsserver.js");
    const local = path.join(root, "node_modules", "typescript", "lib", "tsserver.js");
    const tsserver = existsSync(local) ? local : existsSync(own) ? path.resolve(own) : undefined;
    return {
      command: process.execPath, args: [cli, "--stdio"],
      init: { disableAutomaticTypingAcquisition: true, hostInfo: "astra-gjallarhorn", tsserver: { ...(tsserver ? { path: tsserver } : {}), useSyntaxServer: "never", logVerbosity: "off" } },
      env: { npm_config_offline: "true" },
    };
  }
  if (language === "csharp") {
    const dll = await newestRoslyn();
    if (!dll) return { error: "Roslyn language server not found. Install the Microsoft C# VS Code extension or set ASTRA_ROSLYN_LS to Microsoft.CodeAnalysis.LanguageServer.dll (no automatic download)." };
    const logDir = await mkdtemp(path.join(os.tmpdir(), "astra-roslyn-"));
    return {
      command: "dotnet", args: [dll, "--stdio", "--logLevel", "Warning", "--telemetryLevel", "off", "--extensionLogDirectory", logDir, "--clientProcessId", String(process.pid)],
      env: { DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1", DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1", DOTNET_CLI_UI_LANGUAGE: "en", VSLANG: "1033", PreferredUILang: "en-US" }, cleanup: () => rm(logDir, { recursive: true, force: true }),
      configuration: (item) => {
        const section = item.section ?? "";
        if (/automatic_?restore/i.test(section) || /file_based_programs/i.test(section)) return false; // no implicit NuGet restore / network
        if (/projects\.binary_log_path|dotnet_binary_log/i.test(section)) return null;
        return null;
      },
    };
  }
  return { error: `No language server is configured for ${language}.` };
}

async function findUp(start, stop, predicate) {
  let dir = start;
  for (;;) {
    let names = [];
    try { names = await readdir(dir); } catch { /* unreadable */ }
    const hit = predicate(names);
    if (hit) return path.join(dir, hit);
    if (norm(dir) === norm(stop) || path.dirname(dir) === dir) return undefined;
    dir = path.dirname(dir);
  }
}

export async function workspaceFor(language, file, cwd) {
  const dir = path.dirname(file);
  if (language === "typescript") {
    const hit = await findUp(dir, cwd, (names) => names.find((n) => n === "tsconfig.json") ?? names.find((n) => n === "jsconfig.json") ?? names.find((n) => n === "package.json"));
    return { root: hit ? path.dirname(hit) : cwd };
  }
  const sln = await findUp(dir, cwd, (names) => names.find((n) => /\.(sln|slnx)$/i.test(n)));
  const proj = await findUp(dir, cwd, (names) => names.find((n) => /\.csproj$/i.test(n)));
  const root = sln ? path.dirname(sln) : proj ? path.dirname(proj) : cwd;
  return { root, solution: sln, project: proj };
}

// ---------------- manager ----------------
export class LspManager {
  constructor({ idleMs = 10 * 60_000 } = {}) { this.clients = new Map(); this.idleMs = idleMs; this.children = new Set(); }
  async get(language, file, cwd) {
    // Long, canonical paths only: tsserver's file watcher aborts on Windows 8.3 short names (RUNNER~1).
    file = canonical(file); cwd = canonical(cwd);
    const ws = await workspaceFor(language, file, cwd);
    const key = `${language}|${norm(ws.root)}`;
    let entry = this.clients.get(key);
    if (!entry) {
      entry = { starting: this.start(language, ws), key };
      this.clients.set(key, entry);
      entry.starting.catch(() => this.clients.delete(key));
    }
    const client = await entry.starting;
    if (client.exited) { this.clients.delete(key); return this.get(language, file, cwd); } // server died: start a fresh one
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => this.stop(key), this.idleMs);
    entry.timer.unref?.();
    return client;
  }
  async start(language, ws) {
    const spec = await resolveServer(language, ws.root);
    if (spec.error) throw new Error(spec.error);
    const client = new LspClient({ command: spec.command, args: spec.args, cwd: ws.root, env: spec.env, rootUri: toUri(ws.root), serverRequests: { configuration: spec.configuration }, label: language });
    client.cleanup = spec.cleanup;
    this.children.add(client);
    try {
      await client.initialize({ initializationOptions: spec.init });
      if (language === "csharp") {
        if (ws.solution) client.notify("solution/open", { solution: toUri(ws.solution) });
        else if (ws.project) client.notify("project/open", { projects: [toUri(ws.project)] });
        const deadline = Date.now() + 120_000;
        while (!client.flags.projectsReady && Date.now() < deadline && !client.exited) await sleep(100);
        if (!client.flags.projectsReady) throw new Error("Roslyn did not finish loading the solution/project in time");
      }
    } catch (error) { await client.dispose(); await client.cleanup?.(); throw error; }
    return client;
  }
  async stop(key) {
    const entry = this.clients.get(key);
    if (!entry) return;
    this.clients.delete(key);
    clearTimeout(entry.timer);
    try { const c = await entry.starting; await c.dispose(); await c.cleanup?.(); } catch { /* never started */ }
  }
  async stopAll() { await Promise.all([...this.clients.keys()].map((k) => this.stop(k))); }
  pids() { return [...this.clients.values()].map((e) => e.starting && undefined).filter(Boolean); }
}

// ---------------- formatting ----------------
const SEVERITY = { 1: "error", 2: "warning", 3: "info", 4: "hint" };
export function formatDiagnostics(file, diagnostics, sourceText) {
  const lines = sourceText?.split(/\r?\n/);
  return diagnostics.map((d) => {
    const head = `${file}:${d.range.start.line + 1}:${d.range.start.character + 1} ${SEVERITY[d.severity] ?? "error"} ${d.code ?? ""}${d.source ? ` (${d.source})` : ""}: ${d.message}`;
    const code = lines?.[d.range.start.line]?.trim();
    return code ? `${head}\n    > ${code.slice(0, 200)}` : head;
  }).join("\n");
}
export function normaliseLocations(result) {
  const list = Array.isArray(result) ? result : result ? [result] : [];
  return list.map((loc) => {
    const uri = loc.uri ?? loc.targetUri;
    const range = loc.range ?? loc.targetSelectionRange ?? loc.targetRange;
    return { path: fromUri(uri), line: range.start.line + 1, column: range.start.character + 1 };
  });
}

export default async function (pi) {
  const { Type } = await import("typebox");
  const manager = new LspManager();
  pi.on("session_shutdown", async () => { await manager.stopAll(); });
  // Synchronous: promises do not run during process exit.
  process.once("exit", () => { for (const c of manager.children) { try { c.child.kill(); } catch { /* already gone */ } } });

  const resolveInput = (ctx, p) => {
    const abs = path.resolve(ctx.cwd, p);
    const rel = path.relative(norm(ctx.cwd), norm(abs));
    if (rel.startsWith("..") || path.isAbsolute(rel)) return { error: `Path ${p} is outside the working directory.` };
    const lang = languageFor(abs);
    if (!lang) return { error: `No language server for ${path.extname(abs) || "this file type"}. Supported: .ts .tsx .js .jsx .mts .cts .mjs .cjs .cs` };
    if (!existsSync(abs)) return { error: `File not found: ${p}` };
    return { abs, server: lang[0], languageId: lang[1] };
  };
  const text = (t, isError = false, details = {}) => ({ content: [{ type: "text", text: t }], details, isError });

  pi.registerTool({
    name: "lsp_diagnostics",
    label: "LSP diagnostics",
    description: "Get compiler/semantic diagnostics for a TypeScript/JavaScript or C# file from a real language server. The file is re-read from disk. Result is ERRORS, CLEAN (server confirmed no diagnostics for the current content) or INCONCLUSIVE (server gave no answer; do not treat as clean).",
    promptSnippet: "Semantic diagnostics (TypeScript/C#) from a language server",
    promptGuidelines: ["Use lsp_diagnostics after editing a .ts, .tsx, .js or .cs file to confirm errors are gone. Treat INCONCLUSIVE as unknown and fall back to the project's compiler or test command."],
    parameters: Type.Object({ path: Type.String({ description: "File path relative to the working directory" }) }),
    async execute(_id, params, _signal, _update, ctx) {
      const t = resolveInput(ctx, params.path);
      if (t.error) return text(t.error, true);
      try {
        const client = await manager.get(t.server, t.abs, ctx.cwd);
        const result = await client.diagnose(t.abs, t.languageId);
        if (result.diagnostics === undefined) return text(`INCONCLUSIVE: the ${t.server} server did not provide complete diagnostics for ${params.path} (version ${result.version}). This is not a clean result.`, false, { status: "inconclusive" });
        const hidden = result.diagnostics.filter((d) => (d.severity ?? 1) > 2).length;
        const real = result.diagnostics.filter((d) => (d.severity ?? 1) <= 2);
        const errors = real.filter((d) => (d.severity ?? 1) === 1);
        if (!real.length) return text(`CLEAN: ${params.path} has no errors or warnings (server ${t.server}, ${result.source}, version ${result.version}${hidden ? `; ${hidden} info/hint item(s) hidden` : ""}).`, false, { status: "clean", version: result.version });
        return text(`${errors.length ? "ERRORS" : "WARNINGS"}: ${real.length} diagnostic(s) in ${params.path}\n${formatDiagnostics(params.path, real, await readFile(t.abs, "utf8").catch(() => undefined))}`, false, { status: errors.length ? "errors" : "warnings", count: real.length, version: result.version });
      } catch (error) { return text(`LSP unavailable: ${error.message}`, true, { status: "unavailable" }); }
    },
  });

  const locationTool = (name, label, method, description, extra = {}) => pi.registerTool({
    name, label, description,
    parameters: Type.Object({
      path: Type.String({ description: "File path relative to the working directory" }),
      line: Type.Number({ description: "1-based line" }),
      column: Type.Number({ description: "1-based column" }),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const t = resolveInput(ctx, params.path);
      if (t.error) return text(t.error, true);
      try {
        const client = await manager.get(t.server, t.abs, ctx.cwd);
        await client.sync(t.abs, t.languageId);
        let locations = [];
        for (let attempt = 0; attempt < 4 && !locations.length; attempt++) { // project may still be loading: empty answers are retried briefly
          if (attempt) await sleep(1500);
          locations = normaliseLocations(await client.request(method, { textDocument: { uri: toUri(t.abs) }, position: { line: params.line - 1, character: params.column - 1 }, ...extra }, 30000));
        }
        if (!locations.length) return text("No results.", false, { count: 0 });
        return text(locations.map((l) => `${path.relative(ctx.cwd, l.path)}:${l.line}:${l.column}`).join("\n"), false, { count: locations.length });
      } catch (error) { return text(`LSP unavailable: ${error.message}`, true, { status: "unavailable" }); }
    },
  });
  locationTool("lsp_definition", "LSP definition", "textDocument/definition", "Find where the symbol at a position is defined (TypeScript/JavaScript/C#). Positions are 1-based.");
  locationTool("lsp_references", "LSP references", "textDocument/references", "Find all references to the symbol at a position (TypeScript/JavaScript/C#). Positions are 1-based.", { context: { includeDeclaration: true } });

  pi.registerCommand("lsp", {
    description: "Language servers. Usage: status|stop",
    async handler(args, ctx) {
      const option = args.trim() || "status";
      if (option === "stop") { await manager.stopAll(); ctx.ui.notify("Language servers stopped.", "info"); return; }
      const running = [...manager.clients.keys()];
      const ts = await resolveServer("typescript", ctx.cwd);
      const cs = await resolveServer("csharp", ctx.cwd);
      await cs.cleanup?.();
      ctx.ui.notify(`Running: ${running.join(", ") || "none"}\nTypeScript: ${ts.error ? "NOT INSTALLED" : "available"}\nC#: ${cs.error ? "NOT FOUND" : "available"}\nServers are never downloaded automatically.`, "info");
    },
  });
}
