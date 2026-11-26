---
name: correct
description: Diagnose and repair actual code or runtime failures using reproduction evidence and existing regression checks. Use for actual defects, not ordinary questions.
---

# Correct

Read project instructions and relevant code. Use supplied evidence when available; otherwise find a safe documented reproduction or explain what is missing. Trace the affected data and control flow, identify the root cause, and make the smallest correct change within the authorized scope. Preserve existing tests and assertions; add relevant regression coverage when appropriate.

Use the edit tool according to its actual schema. With Better Edit, copy actual anchors from read output; for a one-line replacement use the same anchor for both endpoints, preserve whitespace and adjacent lines, and reread stale anchors.

Rerun the original reproduction and relevant project checks if available and safe. Use real command output and exit status, distinguish local from remote verification, and review the diff. Report limitations honestly. Avoid repeating unchanged failed approaches. Do not install tools, change providers, or deploy without authorization.
