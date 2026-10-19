// Prepares the notes of a GitHub release (the file given). GitHub turns a bare @name into a mention of the account with that
// name (@everyone and @here are real accounts) and lists it as a contributor of the release, so outside code spans such a
// name is put in a code span.
const fs = require('fs');

const quoteMentions = (text) => text.split('\n').map((line) => line.split('`').map((part, i) => (i % 2
  ? part
  : part.replace(/(^|[^\w@/.])@([A-Za-z0-9][A-Za-z0-9-]*)/g, '$1`@$2`'))).join('`')).join('\n');

if (require.main === module) {
  const file = process.argv[2];
  fs.writeFileSync(file, quoteMentions(fs.readFileSync(file, 'utf8')));
}

module.exports = { quoteMentions };
