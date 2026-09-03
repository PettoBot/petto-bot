const { createRoleplayCommand } = require('../../utils/roleplay');

module.exports = createRoleplayCommand('laugh', {
  aliases: ['lol'],
  label: 'laugh',
  verb: 'laughs with',
  self: '**{actor}** laughs happily.',
  description: 'Share a laugh with someone.',
});
