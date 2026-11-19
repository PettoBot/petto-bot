// Message roles: a role given at a number of messages (utils/messageRoles.ts, commands/welcome/messagerole.js). Reference catalog: es and pt-BR must have the same keys.
module.exports = {
  'messageroles.managed': '{role} is managed by an integration or is @everyone: it cannot be given or taken.',
  'messageroles.aboveMe': '{role} is above my highest role, so I cannot give or take it. Move my role above it.',
  'messageroles.problem.full': 'There is no room: a server can have {max} rules of this kind.',
  'messageroles.problem.messages': 'The number of messages must be from 1 to {maxMessages}.',
  'messageroles.problem.period': 'The days of the period must be from 1 to {maxDays}.',
  'messageroles.rule.total': '**{messages}** messages',
  'messageroles.rule.period': '**{messages}** messages in the last **{days}** days',
  'messageroles.rule.periodRemove': '**{messages}** messages in the last **{days}** days (taken away if they fall under)',
  'messageroles.added': '{emoji} From now on, {role} is given to members who reach {rule}.',
  'messageroles.countsFromNow': 'Messages are counted from now on: the ones sent before the first rule are not counted. A member gets the role right after the message that reaches it.',
  'messageroles.removed': '{emoji} Stopped giving {role} by messages ({count} removed). Members keep the roles they already have.',
  'messageroles.notFound': 'There is no rule for {role}.',
  'messageroles.empty': 'No role is given by messages yet. Add one with `add`.',
  'messageroles.listTitle': '**Roles by messages** ({count} of {max})',
  'messageroles.line': '{role} at {rule}{off}',
  'messageroles.off': 'off',
};
