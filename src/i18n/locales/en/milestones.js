// Milestone rewards of partners and uploads (`reward add|remove|list`): a role and a message when a member reaches a number.
// Reference catalog: es and pt-BR must have the same keys and placeholders.
module.exports = {
  'milestones.auditReason': 'Milestone reward: {count}',
  'milestones.choose': 'Choose add, remove or list.',
  'milestones.badCount': 'The number to reach is a whole number from 1 to 1000000.',
  'milestones.needRole': 'Say the role to give: `reward add <count> <role> [message]`.',
  'milestones.badRole': 'That role can not be given (it is @everyone or managed by an integration).',
  'milestones.cannotGive': 'I can not give {role}: I need Manage Roles and the role has to be below my highest role.',
  'milestones.limit': 'A server can have up to {limit} rewards here. Remove one first.',
  'milestones.added': 'At {count} the role {role} is given.',
  'milestones.addedMessage': 'At {count} the role {role} is given and the message is posted.',
  'milestones.removed': 'The reward at {count} is removed. Roles already given stay.',
  'milestones.notListed': 'There is no reward at {count}.',
  'milestones.partner.title': '### Partnership rewards',
  'milestones.partner.empty': 'No partnership rewards yet. Add one with `reward add <count> <role> [message]`.',
  'milestones.upload.title': '### Upload rewards',
  'milestones.upload.empty': 'No upload rewards yet. Add one with `reward add <count> <role> [message]`.',
};
