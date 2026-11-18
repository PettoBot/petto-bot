// Several messages for the welcome, the goodbye and the boost (utils/messageVariantsCommand.ts). Reference catalog: es and pt-BR must have the same keys.
module.exports = {
  'welcomevariants.kind.welcome': 'welcome',
  'welcomevariants.kind.leave': 'goodbye',
  'welcomevariants.kind.boost': 'boost',
  'welcomevariants.needText': 'Write the message, or the name of a saved embed in `embed`.',
  'welcomevariants.noEmbed': 'There is no saved embed called "{name}".',
  'welcomevariants.full': 'There is no room: "{kind}" can have {max} messages in all.',
  'welcomevariants.added': '{emoji} Added. "{kind}" now has {total} messages; one is picked at random each time, never the same one twice in a row.',
  'welcomevariants.firstNote': 'Number 1 is the main message: change it with `setup`. Only the others can be removed here.',
  'welcomevariants.removed': '{emoji} Removed message number {number}.',
  'welcomevariants.notFound': 'There is no message number {number}: look at the list first.',
  'welcomevariants.template': 'saved embed "{name}"',
  'welcomevariants.listTitle': '**{kind} messages** ({count} of {max}): one is picked at random each time.',
  'welcomevariants.listEmpty': '"{kind}" has no message yet. Set the first one with `setup`.',
};
