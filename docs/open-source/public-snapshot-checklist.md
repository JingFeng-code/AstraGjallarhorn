# Public snapshot preparation — REVIEW ONLY

The explicit [file plan](public-source-plan.json) is bound to the existing preparation commit, not to a moving branch or the working tree. It lists 124 retained paths and 23 excluded paths. It is a candidate inventory, not an approval or a claim that every retained file has been reviewed.

## Decisions implemented

- Preserve the private repository with all history, PRs and evidence; do not toggle its visibility, rename it, mirror it, or push any refs.
- Exclude private continuation notes, historical evidence and audit documents from a clean public snapshot. Exclude the two real formal-Pi / Herdr tests that exercise a user's installed environment; retain synthetic RPC and isolated local-model tests.
- Prepare neutral `agent/AGENTS.md` and empty provider baseline templates. Preserve verification-first behavior, explicit consent, no automatic provider switch and no paid operations. Personal user preferences do not belong in the public template.
- Replace public-facing README and Security/Notices with publication-specific versions once the destination and licensing are approved. Old private links, unreleased version claims and references to excluded evidence must not be carried over.
- Retain existing workflow as a **review candidate only**. Before publication, check immutable action pins, read-only permissions, fork approval policy, and no hidden paid runners or external credentials. Do not open a private PR that triggers CI; the existing zero-spend budget must stay unchanged.
- Upstream license files at the recorded deepseek-stack and Cursor pstack revisions were fetched and matched MIT/copyright notices. This does not itself prove all first-party ownership or all copied material's provenance.

## Remaining gates

1. Inspect exact retained blobs and templates; scan for real secrets, internal hosts, personal paths, copyrighted material and private links. Verify that no dependency on excluded files remains.
2. Owner approves first-party license and copyright holder. MIT remains a proposal. Do not publish unapproved code.
3. Owner chooses a public repository name. If the original name is required, decide separately whether and how to rename the private repository; this can affect remotes and existing links. A different new name avoids changing the original repository.
4. Prepare a clean directory using only reviewed Git blobs from the pinned source, approved replacements, license and documentation; verify the resulting file list/hash. Never copy .git, use a fork/mirror, or export personal Pi configuration.
5. Review and run the exact public snapshot tests in an isolated environment and use only standard GitHub-hosted runners after publication approval. Public CI is not a blanket guarantee against other GitHub or provider charges.
6. Create the new repository only after explicit publication approval. Current GitHub connection does not expose repository creation or visibility changes; owner may need to perform that one administrative action in GitHub. No deployment, license adoption, rename, merge, or release has been performed.

For an in-place visibility change, all original history/log/artifact and settings blockers in [open-source-readiness.md](../open-source-readiness.md) remain. Clean-snapshot publication avoids copying them but does not replace review of the selected source.
