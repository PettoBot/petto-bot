// What exactly is missing when Petto could not do something (utils/permissionDiagnosis.ts, utils/permissionAlerts.ts): told to the member who asked, to the staff in the log channel and in the dashboard.
module.exports = {
  'permdiag.here.server': 'in this server',
  'permdiag.here.channel': 'in {channel}',
  'permdiag.item': '**{permission}** {where}',
  'permdiag.member.single': 'I could not do that: I am missing **{permission}** {where}. Ask the staff to give it to me.',
  'permdiag.member.many': 'I could not do that: I am missing these permissions: {list}. Ask the staff to give them to me.',
  'permdiag.role.above': 'The role {role} is above my highest role, so I cannot give it or take it away. Ask the staff to move my role above it.',
  'permdiag.role.managed': 'The role {role} belongs to an integration (a bot or a service), so I cannot give it or take it away.',
  'permdiag.member.above': 'That member has a role as high as mine or higher (or owns the server), so I cannot do that to them. Ask the staff to move my role above theirs.',
  'permdiag.feature.command': 'the command **{name}**',
  'permdiag.feature.event': 'the **{name}** event',
  'permdiag.feature.ticket': 'a ticket action',
  'permdiag.feature.task': 'a task of Petto',
  'permdiag.notice.feature': 'What failed: {feature} (it has happened {count} times).',
};
