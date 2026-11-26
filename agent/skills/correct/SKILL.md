---
name: correct
description: Diagnose and repair actual code or runtime failures using reproduction evidence and existing regression checks. Use for actual defects, not ordinary questions.
---

# Correct

Read project instructions and relevant code. Before changing implementation, run an available safe documented reproduction or existing failing regression. If it cannot be run, explain why; supplied evidence alone is not a locally executed reproduction. Trace the affected data and control flow, identify the root cause, and make the smallest correct change within the authorized scope. Preserve existing tests and assertions; add relevant regression coverage when appropriate.

Use the edit tool according to its actual schema. With Better Edit, copy actual anchors from read output; for a one-line replacement use the same anchor for both endpoints, preserve whitespace and adjacent lines, and reread stale anchors.

After the last implementation edit, rerun the original reproduction and relevant project checks as standalone commands if available and safe. Inspect the final diff, not only the initial diff. If editing again, repeat the affected checks. Use real command output and exit status, distinguish local from remote verification, and review the diff. Report limitations honestly. Avoid repeating unchanged failed approaches. Do not install tools, change providers, or deploy without authorization.
