import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import register from "../extensions/hashline.js";

test("Pi commands replace an exact range and reject stale snapshots", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "astra-hashline-"));
  const target = path.join(cwd, "fixture.txt");
  const commands = new Map();
  register({ registerCommand: (name, command) => commands.set(name, command) });

  async function run(name, args) {
    let result;
    await commands.get(name).handler(JSON.stringify(args), {
      cwd,
      ui: { notify: (message, level) => { result = { message, level }; } },
    });
    return result;
  }

  try {
    await writeFile(target, "\uFEFFsame\r\nsame\r\nlast\r\n");
    const file = "fixture.txt";
    const read = await run("hashline", { file });
    assert.equal(read.level, "info");
    const [header, , second, third] = read.message.split("\n");
    const hash = header.match(/[a-f0-9]{64}/)[0];
    const first = second.split(" | ")[0];
    const last = third.split(" | ")[0];
    const request = { file, hash, first, last, lines: ["changed"] };
    const invalid = await run("hashreplace", { ...request, first: "2:invalid" });
    assert.match(invalid.message, /Invalid line anchor/);
    const edit = await run("hashreplace", request);
    assert.equal(edit.level, "info", edit.message);
    assert.equal(await readFile(target, "utf8"), "\uFEFFsame\r\nchanged\r\n");
    await writeFile(target, "\uFEFFsame\r\nexternal edit\r\n");
    const stale = await run("hashreplace", request);
    assert.match(stale.message, /Stale snapshot/);
    assert.equal(await readFile(target, "utf8"), "\uFEFFsame\r\nexternal edit\r\n");
    const outside = await run("hashline", { file: "../outside.txt" });
    assert.match(outside.message, /stay inside/);
  } finally {
    await rm(path.join(cwd, "fixture.txt"), { force: true });
    await rmdir(cwd);
  }
});
