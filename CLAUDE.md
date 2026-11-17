# Rules for this repository

## Every change goes to the Currently log

**Any change, in any repository of Petto (the bot, the web, the wikis, the Code Generator), must also be written in the Currently log.** It does not matter how small it is, or whether it is a fix, an addition, an improvement, a change of the web or the docs, or a removal: if somebody could notice it, or it is worth knowing, it gets an entry. The only things left out are changes nobody can notice and that change nothing (a typo in a comment, a rename inside the code).

How: add an entry at the end of `entries` in `src/data/currentlyLog.json` of the repository `PettoBot/petto-web` (the bot reads it from the web every ten minutes and posts it in Discord). Do it in a pull request of the web right after (or with) the change, and write "Currently log: <id>" in the pull request of this repository. The rules of the file are in `scripts/check-currently-log-file.mjs` of the web (it runs with `npm run check` there):

- A new `id` that was never used (lowercase letters, numbers and dashes), a `category` (`security`, `feature`, `addition`, `improvement`, `fix`, `web`, `removal` or `removed-feature`), a `title` (100 characters at most), an `area` (80), and a `summary` (700) in plain words for the community: what changed and what it means for them, no code stats.
- Pictures are optional but wanted for everything that can be seen: up to 3, files of `public/assets/log/` in the web, named by their https address (`https://petto.sbs/assets/log/<name>.png`). Make them in dark mode, with nothing empty around the thing shown.
- Do not raise `revision` (that posts the whole log again and deletes the old cards); only add entries.

## One pull request per repository

Everything of one piece of work goes in one pull request for each repository, not one per step. If a pull request of the same work is already open, push to its branch instead of opening another.

## Commits and pull requests

No signatures or attribution lines in commit messages or pull request bodies. A pull request follows the template of the repository and its text has to stay true to what the pull request holds now.
