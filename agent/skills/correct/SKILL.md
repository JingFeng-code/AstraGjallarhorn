---
name: correct
description: Diagnose and fix a supplied reproducible failure, then verify the existing regression.
disable-model-invocation: true
---

Use the failure and file supplied by the user. Inspect the specific file with lowercase read. Correct the root cause with lowercase edit using the exposed schema. Preserve the failing check. For a single-line Better Edit correction, use the same anchor as both anchor_from and anchor_to, and keep all adjacent lines unchanged. Copy the entire target line from after the anchor separator, preserving whitespace and delimiters; change only the offending value. Do not infer the anchor from the line number. Rerun the exact supplied command if bash is available; otherwise report that the independent check is still required. Stop after the fix or after repeating an unresolved failure once. Do not use Write or invent commands.
