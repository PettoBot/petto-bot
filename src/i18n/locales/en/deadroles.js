// A role that a server chose in a Petto setting and then deleted: the note for its staff, in the log channel of the server.
module.exports = {
  'deadroles.title': '{emoji} A role chosen in Petto no longer exists',
  'deadroles.body': 'The role `{role}` chosen for {where} was deleted from this server.',
  'deadroles.where.verification': 'verification',
  'deadroles.where.gate': 'the verification gate (the role for members who have not verified)',
  'deadroles.where.join': 'the join roles',
  'deadroles.where.reaction': 'a reaction role',
  'deadroles.where.level': 'a level reward',
  'deadroles.where.button': 'a role button or menu',
  'deadroles.where.invite': 'an invite reward',
  'deadroles.action.removed': 'Petto took it out of that setting so nothing keeps failing. Pick a new role there whenever you want one.',
  'deadroles.action.pick': 'Open that setting in the dashboard and pick the role again.',
  'deadroles.action.verification.removed': 'Petto cleared it from the verification settings so nothing keeps failing. Open the verification settings in the dashboard (or run `/verify setup`) and pick a role again. Until then, members who pass the check count as verified in Petto but get no role.',
  'deadroles.action.made': 'Petto created a new role called **{name}** and saved it in that setting.',
};
