# AI-assisted development policy

Petto allows the use of AI tools during development, provided that a human
maintainer remains responsible for the final change. AI assistance does not
replace code review, testing, security review, or the contributor's ownership
of the submitted work.

## Permitted use of AI

AI tools may be used for:

- explaining existing code, errors, or API behavior;
- researching documentation and comparing implementation options;
- drafting or improving production code, tests, migrations, configuration,
  workflows, and documentation;
- reviewing designs, accessibility, security, and release notes;
- translating or improving issue and pull request wording.

## Requirements

Every contributor and maintainer must:

- understand the submitted change well enough to explain and maintain it;
- review generated suggestions for correctness, security, licensing, and
  compatibility with Petto's architecture;
- run the relevant syntax checks, tests, builds, and integration checks;
- avoid copying secrets, tokens, private user data, production logs, or other
  confidential material into an AI tool;
- disclose substantial AI assistance when requested during review, especially
  when it affects security-sensitive or architectural code.

AI-generated output is treated like any other external suggestion: it must be
verified, adapted to the project, and accepted by a maintainer before it is
merged.

## Contributor declaration

By opening a pull request, the contributor confirms that they reviewed the
change, understand its behavior, and followed this policy. Maintainers may ask
for additional tests, an explanation of the design, or a focused rewrite when
the provenance or safety of a change is unclear.
