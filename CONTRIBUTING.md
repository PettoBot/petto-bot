# Contributing to Petto

Thank you for your interest in Petto. This repository is maintained with a
deliberate review process so changes remain secure, compatible, and consistent
with the bot's existing behavior.

## Before writing code

1. Read this file, [GOVERNANCE.md](GOVERNANCE.md), [AI_POLICY.md](AI_POLICY.md),
   [SECURITY.md](SECURITY.md), and [DCO.md](DCO.md).
2. Search existing issues and discussions.
3. Open a proposal issue or discussion before implementing a feature, behavior
   change, new dependency, schema change, or architectural change.
4. Wait for a maintainer to mark the proposal as accepted or explicitly invite
   a contribution. A proposal is not approval merely because it is open.

Unsolicited implementation pull requests may be closed without review and
redirected to a proposal. This keeps the public contribution path clear and
prevents duplicate or incompatible work.

## Development workflow

After a proposal is accepted:

1. Fork the repository and create a focused branch such as `fix/<short-name>`
   or `feature/<short-name>`.
2. Keep the change narrow. Preserve existing command syntax, database behavior,
   permissions, and user-facing contracts unless the proposal explicitly
   changes them.
3. Never add credentials, tokens, cookies, `.env` files, private deployment
   data, database dumps, or real user data.
4. Run `npm ci` and `npm run check` locally.
5. Open a draft pull request only after the proposal is accepted. Link the
   proposal and explain the behavior, tests, migration impact, and rollback
   considerations.

## Pull request requirements

Every pull request must:

- link an accepted issue or discussion;
- explain what changed and why;
- include tests or a clear reason tests are not applicable;
- document database or configuration changes without including secret values;
- comply with [AI_POLICY.md](AI_POLICY.md);
- include a `Signed-off-by:` line on every commit, as described in [DCO.md](DCO.md);
- pass the repository checks and maintainer review.

Do not force-push after review without telling the reviewer. Do not rewrite
shared branches. Maintainers may request a squash or rebase before merging.

## Commit sign-off

Use `git commit -s` so Git adds your DCO sign-off. The sign-off must use your
real name or an identity you control and an email address you control. Never
place tokens or other secrets in commit messages.

## Security-sensitive changes

Do not disclose vulnerabilities in a public issue or pull request. Follow
[SECURITY.md](SECURITY.md). Security fixes may use a private advisory process
and can be reviewed under a restricted branch before public release.

## Review standard

Reviewers prioritize security, permission boundaries, data safety, backward
compatibility, operational clarity, and maintainability. A contribution can be
declined even when it works if it creates disproportionate risk or maintenance
cost.
