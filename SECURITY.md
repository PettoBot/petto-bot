# Security policy

## Reporting a vulnerability

Do not open a public issue, discussion, or pull request for a suspected
vulnerability. Use GitHub's private vulnerability reporting or a private
security advisory for this repository when available. Include a concise
description, affected version or commit, reproduction steps, impact, and a
safe suggested fix if you have one.

If private reporting is not available, contact the Petto maintainers through
the official support route listed in the repository profile and clearly mark
the message as confidential. Do not include credentials in the report.

## Secret exposure

If a token, key, cookie, database URL, or other credential is committed or
shared accidentally, revoke or rotate it immediately. Removing a file from a
later commit does not make a secret safe: exposed credentials must be treated
as compromised and the Git history must be cleaned before publication.

## Supported versions

Only the latest published version and the current default branch are normally
eligible for security fixes. Maintainers may backport a fix when the impact
justifies it.

## Scope

This policy covers the Petto source, its official deployment configuration,
and security-sensitive behavior in the repository. Third-party services,
hosting accounts, and unrelated forks must be reported to their respective
owners.
