import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { collectDiff, fingerprint, scopeReport, boundedText } from "../extensions/diff-review.js";

const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8" });

test("collects staged, unstaged and untracked changes, flags missing regression tests, and changes nothing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "astra-review-"));
  try {
    git(root, "init", "-q"); git(root, "config", "user.email", "t@e.test"); git(root, "config", "user.name", "t");
    await mkdir(path.join(root, "src")); await mkdir(path.join(root, "tests"));
    await writeFile(path.join(root, "src", "a.ts"), "export const a = 1;\n");
    await writeFile(path.join(root, "tests", "a.test.ts"), "test();\n");
    await writeFile(path.join(root, "README.md"), "doc\n");
    git(root, "add", "-A"); git(root, "commit", "-qm", "init");
    await writeFile(path.join(root, "src", "a.ts"), "export const a = 2;\n");
    git(root, "add", "src/a.ts");
    await writeFile(path.join(root, "src", "a.ts"), "export const a = 3;\n");
    await writeFile(path.join(root, "src", "b.ts"), "export const b = 1;\n");
    const before = await fingerprint(root);
    const { text, report } = await collectDiff(root);
    const after = await fingerprint(root);
    assert.equal(before, after, "review did not touch the work tree");
    assert.match(text, /\+export const a = 2;/, "staged diff present");
    assert.match(text, /\+export const a = 3;/, "unstaged diff present");
    assert.match(text, /Untracked files\nsrc\/b\.ts/);
    assert.ok(report.flags.some((f) => /REGRESSION-TEST GAP/.test(f)));
    assert.ok(report.flags.some((f) => /PARTIALLY STAGED: src\/a\.ts/.test(f)));
    assert.equal(git(root, "stash", "list"), "");
    await writeFile(path.join(root, "x.txt"), "changes the fingerprint");
    assert.notEqual(await fingerprint(root), after, "fingerprint detects a real change");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("scope report recognises tests and docs", () => {
  const r = scopeReport({ staged: ["src/a.ts", "tests/a.test.ts"], unstaged: ["README.md"], untracked: [] });
  assert.deepEqual(r.counts, { source: 1, tests: 1, docs: 1, other: 0 });
  assert.ok(!r.flags.some((f) => /GAP/.test(f)));
});

test("large diff text has an explicit bounded output and retains a truncation marker",()=>{
  const text=boundedText("x".repeat(100000));
  assert.ok(text.length<=30000);
  assert.match(text,/truncated/);
  assert.equal(boundedText("small"),"small");
});
