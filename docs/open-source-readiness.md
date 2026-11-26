# Open-source readiness gate — NO-GO (2026-11-26)

Baseline: `72d214e10288223099c90ec664ef2fc7fd3bf952`, Draft PR #4; CI 45813076819 passed. The source repository is still private. This preparation branch preserves all historical records and development branches. It is not authority to publish or relicense.

## Completed review

- Five original branches, 71 unique reachable commits (branch commit lists each under 100), 173 unique tip blobs, no binary/large (>200 KB) tip blobs from tree metadata; all five branch trees returned without truncation.
- Reviewed added lines in available commit patches across all 71 commits using common token/private-key, literal credential assignment, local home-path and internal URL patterns: 374 file patches; two patches were unavailable. Retrieved their referenced file content separately: historical Vue lockfile and an empty formal-Pi evidence file. This is a heuristic diff review, not complete object-level secret scanning.
- Four PR titles/descriptions and available merged discussion/review timelines (two comments total) had no pattern matches.
- Token-shaped matches in `tests/handoff.test.mjs` are synthetic inputs for the masking regression; retain tests. Other path matches include generic path parsing examples and synthetic Vue test paths. Confirmed real local handoff summary paths in historical evidence; two current notice strings redacted in this branch, keeping the original private history intact. Older pre-review evidence still exists in history.
- Latest tree had no submodule and no tracked files with the checked sensitive names (auth/settings/credentials/env/npmrc/git-credentials/netrc/session/task/handoff). This is a filename check, not an assurance about arbitrary content.
- Bundled third-party MIT license files present for deepseek-stack and three pstack skill adaptations. Root license absent. Candidate first-party MIT text requires rights-holder approval.
- All 4 PRs inventoried (two open, two closed); 0 releases returned; 51 Actions runs inventoried. Tags and repository-level artifacts API unavailable through current connection; rulesets API returned 403. Original five branches reported unprotected.

## Blocking items

- [ ] Complete full reachable object scan with reviewed secret-scanning tooling, including commit metadata, tags, refs, deleted content, custom refs and any Git LFS objects. Inspect matches without copying raw secrets.
- [ ] Review all 51 historical Actions logs, artifacts, caches, retention and any workflow outputs; the run inventory is not a log audit. Review PR attachments/hidden or unavailable refs and any metadata outside the connector's accessible scope.
- [ ] Verify exact upstream license provenance and first-party ownership, confirm contributors' consent and copyright holder, then adopt root LICENSE explicitly.
- [ ] Separate public distribution from personal private synchronization. Review public candidate files including docs, providers, old evidence, links and local paths. Never treat .gitignore or export scanner as DLP.
- [ ] Audit secrets/variables, deploy keys, webhooks, GitHub App access, branch protection/rulesets, fork workflow approval policy, Actions billing/spending controls and vulnerability reporting using repository-owner Settings. Connection cannot inspect sensitive secret/admin APIs or change visibility.
- [ ] Review security of actual workflow and dependency pins; use standard GitHub-hosted runners, minimum permissions, avoid pull_request_target with untrusted checkout, avoid secrets or private source in fork tests. Current workflow uses pull_request, contents: read, checkout persist-credentials: false, windows-latest. Action tags not immutable full SHAs; review supply-chain pinning before public launch. No new CI invocation for this preparation branch.
- [ ] Owner explicitly approves public destination, reviewed contents, licensing and visibility; only then publish. Do not merge/rewrite/delete or switch visibility as part of this preparation.

## Recommendation: clean publication, preserve private history

Prefer a separate clean public source snapshot rather than toggling this repository in place. Do **not** use a fork, mirror, or push all refs. After review and owner approval, create a new public repository from an explicit allowlist of audited tracked files (first-party source, required tests/fixtures, manifests/templates, safe documentation, original notices, approved license and reviewed CI). Exclude raw historical evidence, private audit records, local profiles, journal/session/checkpoint data, backups and hidden refs. Verify all references and documentation still work, scan the complete proposed snapshot, initialize a fresh Git history with public-safe author metadata, check CI on the new repository, and keep the original private repository unchanged.

If the original repository name must be retained, choose the migration/rename strategy explicitly and assess existing local remotes, links, permissions and redirects first. Do not rename or change visibility without approval. A clean snapshot is not a certification that the included code is secure; it reduces historical exposure risk.

Alternatively, in-place visibility change requires the blocking items above, and any necessary historical/log cleanup must be separately authorized. Current-tree path redaction is insufficient to remove old data from Git history. If a real secret is identified, rotate it even before considering publication.

## Acceptance

GO only after the owner has checked all blocking items for the chosen publication route, reviewed the final file set, confirmed license and release status, and authorized the public action. Until then: **NO-GO, keep Private**.

## Clean-snapshot planning supplement

The exact-path candidate inventory, neutral settings templates and remaining approvals are recorded in [public snapshot checklist](open-source/public-snapshot-checklist.md) and [file plan](open-source/public-source-plan.json). The two recorded upstream LICENSE files have now been directly confirmed MIT at their pinned revisions; first-party rights and exact material provenance remain pending. No extra CI was triggered for preparation. No public repo creation or visibility-changing capability is exposed by the current connector.
