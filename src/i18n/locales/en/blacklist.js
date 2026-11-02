// What a server reads when the Petto team blacklists it: the card for its owner (and the answer to a button pressed in the seconds before Petto leaves).
module.exports = {
  'blacklist.notice.title': '{emoji} Petto left this server',
  'blacklist.notice.body': "This server was blacklisted for breaking Petto's terms of service or privacy policy.",
  'blacklist.notice.server': '**Server:** {name} (`{id}`)',
  'blacklist.notice.unknownServer': 'Unknown server',
  'blacklist.notice.reason': '**Reason:** {reason}',
  'blacklist.notice.mistake': 'If you think this is a mistake, contact support: {support}',
  'blacklist.notice.terms': '**Terms of service:** {terms}',
  'blacklist.notice.privacy': '**Privacy policy:** {privacy}',
  'blacklist.unavailable': 'Petto is not available in this server.',
};
