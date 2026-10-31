# Credits and licenses of the card designs

Every picture in this folder (`<family>-<name>.webp` and the gallery pictures in `thumbs/`) is original artwork made for Petto. They are
drawn by code, from scratch, with a seeded random generator: `scripts/designs/` (the drawing kit and one function per design) and
`scripts/make-card-designs.js` (writes the files and `designs.json`). Running `node scripts/make-card-designs.js` again gives the same files.

- No picture was copied, traced or downloaded from a website, a stock library or another bot, and no public-domain (CC0) picture is used,
  so there is no third-party source to credit here.
- `rank-default.webp` and `rank-voice.webp` are the default rank card backgrounds, drawn by `scripts/make-rank-backgrounds.js`.
- The pictures are part of Petto and follow the license of this repository.

The only files that come from elsewhere in the card system are the fonts (`src/assets/fonts`, see `LICENSES.md` there).
