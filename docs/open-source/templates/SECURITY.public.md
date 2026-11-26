# Security policy

## Development status

This repository contains a development preview. It is not a supported production release. Security guarantees are limited to the explicitly tested cases; do not use experimental quality gates as a security boundary.

## Report a vulnerability privately

If private vulnerability reporting is available on GitHub, use the repository's **Security → Report a vulnerability** flow. Otherwise request a private contact channel from the maintainer before disclosing technical details. Do not open a public issue with credentials, private URLs, customer records, terminal logs, exploit details or an unredacted session.

Provide the affected commit/version, a minimal synthetic reproduction, impact, expected behavior and actual behavior. Do not test against other users or live company systems. No response-time guarantee is offered while the project is in development.

## Threat model and limits

- Extensions run with the Pi process's permissions; command guard and opt-in quality contracts are tool-level controls, not OS sandboxes.
- Repository scripts, build tools, dependencies, Git filters, and candidate code may execute arbitrary code as the current user. Review trusted revisions and use a disposable isolated workspace.
- Checkpoints, journals, handoffs, backups and raw tool traces may include confidential source or prompts. Keep them local/private; never mirror local Git refs to a public remote.
- Redaction and credential patterns can miss secrets. Never rely on a clean regex scan as proof of safety.
- Provider credentials and personal Pi settings must stay out of Git. Never upload a company's repositories, artifacts or logs without permission.
- Automatic handoff is opt-in. A no-extra-cost declaration does not verify provider billing. No automatic provider changes or deployments should occur.
- Public CI must use read-only permissions, no credential-bearing fork workflows, approved standard hosted runners, and reviewed workflows/dependencies. Never run untrusted external PR code with repository secrets or on a personal/self-hosted machine.

If a real credential is found, revoke or rotate it first, assess affected systems, and coordinate history/log cleanup. Removing the current file alone is not sufficient.

## Safe contribution

Use synthetic data, review staged changes, and keep personal configuration exports, Git checkpoint refs, sessions and raw evidence in a separate private workspace. Do not mirror private repositories into this public project.
