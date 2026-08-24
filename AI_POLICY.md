# AI-assisted development policy

Petto does not accept AI-generated or AI-autocompleted code contributions.
This includes production code, tests, migrations, configuration, workflows,
dependency changes, patches, and generated files submitted for review.

This rule exists because Petto handles moderation, permissions, user data, and
server configuration. Maintainers must be able to establish the origin,
context, and security impact of every code change.

## Permitted use of AI

AI tools may be used for non-code support, including:

- explaining an existing error or API concept;
- researching documentation and comparing alternatives;
- planning tests or reviewing a design before implementation;
- proofreading, translation, and accessibility review of documentation;
- improving issue wording or release notes;
- helping a contributor understand the repository.

Any resulting code must be written and understood by the contributor without
AI generation or autocomplete. Copying, lightly editing, or laundering an AI
output is still a violation of this policy.

## Contributor declaration

By opening a pull request, the contributor confirms that the submitted code
and configuration were authored without generative-AI code generation or
autocomplete. Maintainers may ask for an explanation of authorship, a focused
rewrite, or additional provenance before review.

Do not use AI tools with secrets, private user data, production logs, tokens,
or non-public repository material.
