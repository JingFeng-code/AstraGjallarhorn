import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const anchor = (line, index) => `${index + 1}:${digest(line).slice(0, 12)}`;

async function snapshot(cwd, file) {
  if (typeof file !== "string" || !file || path.isAbsolute(file)) {
    throw new Error("Provide a path relative to the current directory.");
  }
  const root = await realpath(cwd);
  const target = path.resolve(root, file);
  const relative = path.relative(root, target);
  if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw new Error("Path must stay inside the current directory.");
  }
  const info = await lstat(target);
  if (!info.isFile() || (await realpath(target)) !== target || info.size > 1024 * 1024) {
    throw new Error("Choose a regular UTF-8 file of at most 1 MiB with no symlink in its path.");
  }
  const bytes = await readFile(target);
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  if (text.includes("\0") || /\r(?!\n)/.test(text) || (text.includes("\r\n") && /(?<!\r)\n/.test(text))) {
    throw new Error("File must use consistent LF or CRLF text.");
  }
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const hasFinalNewline = text.endsWith(newline);
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const body = text.slice(bom.length, hasFinalNewline ? -newline.length : undefined);
  return { target, info, hash: digest(bytes), lines: body.split(newline), newline, hasFinalNewline, bom };
}

export async function readHashlines(cwd, { file, start = 1 }) {
  const current = await snapshot(cwd, file);
  if (!Number.isSafeInteger(start) || start < 1 || start > current.lines.length) {
    throw new Error("Start must be an existing line number.");
  }
  const lines = current.lines.slice(start - 1, start + 49)
    .map((line, index) => `${anchor(line, start + index - 1)} | ${line.slice(0, 300)}`);
  return [`SHA-256: ${current.hash} (${current.lines.length} lines)`, ...lines].join("\n");
}

export async function replaceHashlines(cwd, { file, hash, first, last, lines }) {
  if (!Array.isArray(lines) || lines.some((line) => typeof line !== "string" || /[\r\n\0]/.test(line))) {
    throw new Error("Replacement must be an array of single-line strings.");
  }
  const current = await snapshot(cwd, file);
  if (current.hash !== hash) throw new Error("Stale snapshot. Read the file again before editing.");
  const validAnchor = (value) => {
    const number = Number(String(value).split(":")[0]);
    if (!Number.isSafeInteger(number) || number < 1 || number > current.lines.length ||
        value !== anchor(current.lines[number - 1], number - 1)) {
      throw new Error("Invalid line anchor. Read the range again.");
    }
    return number;
  };
  const begin = validAnchor(first);
  const end = validAnchor(last ?? first);
  if (begin > end) throw new Error("First anchor must precede the last anchor.");
  const replacement = [...current.lines.slice(0, begin - 1), ...lines, ...current.lines.slice(end)];
  const content = current.bom + replacement.join(current.newline) +
    (current.hasFinalNewline && replacement.length ? current.newline : "");
  if (Buffer.byteLength(content) > 1024 * 1024) throw new Error("Replacement exceeds 1 MiB.");

  const temporary = path.join(path.dirname(current.target), `.astra-hashline-${randomUUID()}.tmp`);
  await writeFile(temporary, content, { flag: "wx", mode: current.info.mode });
  try {
    if ((await snapshot(cwd, file)).hash !== hash) throw new Error("File changed before replacement.");
    await rename(temporary, current.target);
  } finally {
    await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
  return `Updated ${file}. SHA-256: ${digest(content)}`;
}

export default function (pi) {
  for (const [name, description, execute] of [
    ["hashline", 'Read lines: /hashline {"file":"path","start":1}', readHashlines],
    ["hashreplace", 'Replace lines using file, hash, first, optional last, and lines', replaceHashlines],
  ]) {
    pi.registerCommand(name, {
      description,
      async handler(args, ctx) {
        try {
          ctx.ui.notify(await execute(ctx.cwd, JSON.parse(args)), "info");
        } catch (error) {
          ctx.ui.notify(error.message, "error");
        }
      },
    });
  }
}
