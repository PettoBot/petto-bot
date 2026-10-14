const TRANSCRIPT_MODES = ['auto', 'link', 'file', 'both'];

/**
 * What goes out with a transcript, from the server's choice:
 *   auto: the link when the web server can give one, the file when it cannot (how it always worked)
 *   link: the link only (the file when there is no link, so nothing is lost)
 *   file: the .html file only
 *   both: the link and the file
 */
function transcriptParts(mode, hasLink) {
  const chosen = TRANSCRIPT_MODES.includes(mode) ? mode : 'auto';
  if (chosen === 'file') return { link: false, file: true };
  if (chosen === 'both') return { link: hasLink, file: true };
  return { link: hasLink, file: !hasLink };
}

module.exports = { TRANSCRIPT_MODES, transcriptParts };
