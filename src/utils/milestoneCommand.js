// `!partnerconfig reward ...` and `!uploadconfig reward ...`: add, remove and list the milestone rewards of a module. Both commands run this code.
const milestonesDb = require('../db/milestones');
const { canGive, MAX_MESSAGE } = require('./milestones');
const { textCard } = require('./caseCard');
const { EMOJI } = require('./emojis');
const { t } = require('../i18n');

const ok = (text) => textCard(`${EMOJI.APPROVE}  ${text}`, 0xa5ea7a);
const note = (text) => textCard(text);
const MAX_COUNT = 1_000_000;

/** The slash options of the `reward` subcommand (the same in both commands). */
function addRewardSubcommand(subcommand) {
  return subcommand.setName('reward').setDescription('Roles given when a member reaches a number. Actions: add, remove, list.')
    .addStringOption((o) => o.setName('action').setDescription('add, remove or list').setRequired(true).addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }, { name: 'list', value: 'list' }))
    .addIntegerOption((o) => o.setName('count').setDescription('The number to reach (for add and remove)').setMinValue(1).setMaxValue(MAX_COUNT).setRequired(false))
    .addRoleOption((o) => o.setName('role').setDescription('The role to give (for add)').setRequired(false))
    .addStringOption((o) => o.setName('message').setDescription('What to say when it is reached, with variables like {user.mention} and {milestone.count}').setMaxLength(MAX_MESSAGE).setRequired(false));
}

/** Runs the subcommand. `kind` is `partner` or `upload`; `done` sends a card. */
async function runReward({ interaction, kind, done, lang }) {
  const action = (interaction.options.getString('action', true) ?? '').toLowerCase();
  const guild = interaction.guild;
  if (action === 'list') {
    const rewards = await milestonesDb.list(guild.id, kind);
    if (!rewards.length) return done(note(t(lang, `milestones.${kind}.empty`)));
    const lines = rewards.slice(0, 25).map((reward) => `**${reward.count}** → <@&${reward.role_id}>${reward.message ? ` · ${reward.message.replace(/\s+/g, ' ').slice(0, 80)}` : ''}`);
    return done(note([t(lang, `milestones.${kind}.title`), ...lines].join('\n')));
  }
  if (!['add', 'remove'].includes(action)) return done(note(t(lang, 'milestones.choose')));
  const count = interaction.options.getInteger('count');
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) return done(note(t(lang, 'milestones.badCount')));
  if (action === 'remove') {
    const removed = await milestonesDb.remove(guild.id, kind, count);
    return done(removed ? ok(t(lang, 'milestones.removed', { count })) : note(t(lang, 'milestones.notListed', { count })));
  }
  const role = interaction.options.getRole('role');
  if (!role) return done(note(t(lang, 'milestones.needRole')));
  if (role.managed || role.id === guild.id) return done(note(t(lang, 'milestones.badRole')));
  if (guild.members?.me && !canGive(guild, role)) return done(note(t(lang, 'milestones.cannotGive', { role: `${role}` })));
  const current = await milestonesDb.list(guild.id, kind);
  if (current.length >= milestonesDb.MAX_REWARDS && !current.some((reward) => reward.count === count)) return done(note(t(lang, 'milestones.limit', { limit: milestonesDb.MAX_REWARDS })));
  const message = (interaction.options.getString('message') ?? '').trim().slice(0, MAX_MESSAGE);
  await milestonesDb.upsert(guild.id, kind, count, role.id, message);
  return done(ok(t(lang, message ? 'milestones.addedMessage' : 'milestones.added', { count, role: `${role}` })));
}

module.exports = { addRewardSubcommand, runReward, MAX_COUNT };
