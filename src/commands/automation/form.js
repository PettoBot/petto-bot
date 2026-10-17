// Forms (applications): staff applications, partner requests, event sign-ups. The admins make forms and post panels with
// `!form`, members answer them from the panel, and the reviewers accept or deny what arrives from the card, here or the dashboard.
const { SlashCommandBuilder, MessageFlags, AttachmentBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const formsDb = require('../../db/forms');
const forms = require('../../utils/forms');
const actions = require('../../utils/formActions');
const { reviewCard } = require('../../utils/formCards');
const { getTemplate } = require('../../db/embedTemplates');
const { ensureGuild } = require('../../db/guilds');
const { resolveRole } = require('../../utils/roleResolve');
const { parseDuration } = require('../../utils/duration');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, tn, languageOf } = require('../../i18n');

const ok = (text) => textCard(`${EMOJI.APPROVE}  ${text}`, 0xa5ea7a);
const note = (text) => textCard(text, 0x4b4f59);
const bad = (text) => textCard(text, 0xf23f43);
const unix = (value) => Math.floor(new Date(value).getTime() / 1000);

const SETTINGS = [
  'title', 'description', 'color', 'channel', 'reviewers', 'ping', 'thread', 'required-roles', 'blocked-roles', 'account-age', 'server-age',
  'one-pending', 'cooldown', 'max-per-user', 'max-total', 'closes', 'accept-roles', 'accept-remove-roles', 'deny-roles', 'deny-remove-roles',
  'dm', 'button-label', 'button-emoji', 'button-style', 'web',
];
const ROLE_SETTINGS = {
  reviewers: 'reviewer_role_ids', ping: 'ping_role_ids', 'required-roles': 'required_role_ids', 'blocked-roles': 'blocked_role_ids',
  'accept-roles': 'accept_add_role_ids', 'accept-remove-roles': 'accept_remove_role_ids', 'deny-roles': 'deny_add_role_ids', 'deny-remove-roles': 'deny_remove_role_ids',
};
const SWITCHES = { thread: 'auto_thread', 'one-pending': 'one_pending', dm: 'dm_results', web: 'web_enabled' };
const NUMBERS = { 'account-age': ['min_account_days', 3650, 86_400_000], 'server-age': ['min_member_days', 3650, 86_400_000], cooldown: ['deny_cooldown_hours', 8760, 3_600_000], 'max-per-user': ['max_per_user', 1000, 0], 'max-total': ['max_total', 100000, 0] };
const QUESTION_FIELDS = ['label', 'type', 'help', 'description', 'image', 'placeholder', 'required', 'min', 'max', 'options', 'choices'];
// With the prefix the types are not checked by Discord, so the usual words are read here.
const TYPE_WORDS = { short: 'short', text: 'short', line: 'short', paragraph: 'paragraph', long: 'paragraph', number: 'number', num: 'number', yesno: 'yesno', 'yes/no': 'yesno', bool: 'yesno', choice: 'choice', select: 'choice', single: 'choice', one: 'choice', multi: 'multi', multiple: 'multi', many: 'multi', checkbox: 'multi' };
const STATUS_WORDS = { pending: 'pending', waiting: 'pending', open: 'pending', accepted: 'accepted', accept: 'accepted', approved: 'accepted', denied: 'denied', deny: 'denied', rejected: 'denied', cancelled: 'cancelled', canceled: 'cancelled' };
const LINK_WORDS = ['new', 'renew', 'regenerate', 'reset', 'nuevo', 'novo'];
const OFF_WORDS = ['none', 'off', 'reset', 'clear', '-'];
const ON = ['on', 'yes', 'true', 'enable', 'enabled', '1'];
const OFF = ['off', 'no', 'false', 'disable', 'disabled', '0'];
const isOff = (text) => OFF_WORDS.includes(String(text ?? '').trim().toLowerCase());

const formOption = (o) => o.setName('form').setDescription('The form: its name or number').setRequired(true);

const data = new SlashCommandBuilder()
  .setName('form')
  .setDescription('Forms and applications: make them, post a panel and review what members send.')
  .setDMPermission(false)
  .addSubcommand((s) => s.setName('create').setDescription('Make a form. It stays closed until you open it.')
    .addStringOption((o) => o.setName('name').setDescription('A short name for commands, like staff').setRequired(true).setMaxLength(32))
    .addStringOption((o) => o.setName('title').setDescription('The title members see (45 characters)').setRequired(false).setMaxLength(45)))
  .addSubcommand((s) => s.setName('delete').setDescription('Delete a form. What members already sent is kept.').addStringOption(formOption))
  .addSubcommand((s) => s.setName('list').setDescription('The forms of this server.'))
  .addSubcommand((s) => s.setName('info').setDescription('Everything about a form: settings, rules and counts.').addStringOption(formOption))
  .addSubcommand((s) => s.setName('open').setDescription('Let members fill in a form.').addStringOption(formOption))
  .addSubcommand((s) => s.setName('close').setDescription('Stop taking answers for a form.').addStringOption(formOption))
  .addSubcommand((s) => s.setName('relink').setDescription('A new web link for a form. The old link stops working.').addStringOption(formOption))
  .addSubcommand((s) => s.setName('set').setDescription('Change a setting of a form. "none" clears it.')
    .addStringOption(formOption)
    .addStringOption((o) => o.setName('setting').setDescription('What to change').setRequired(true).addChoices(...SETTINGS.map((name) => ({ name, value: name }))))
    .addStringOption((o) => o.setName('value').setDescription('The new value').setRequired(true)))
  .addSubcommand((s) => s.setName('message').setDescription('What the member is told when they send it, or when it is accepted or denied.')
    .addStringOption(formOption)
    .addStringOption((o) => o.setName('kind').setDescription('Which message').setRequired(true).addChoices({ name: 'submitted', value: 'submitted' }, { name: 'accepted', value: 'accepted' }, { name: 'denied', value: 'denied' }))
    .addStringOption((o) => o.setName('text').setDescription('The text, with {user}, {form}, {reason}, {number}. "reset" goes back to the default').setRequired(false).setMaxLength(2000))
    .addStringOption((o) => o.setName('template').setDescription('A saved embed for the DM, or "none"').setRequired(false)))
  .addSubcommand((s) => s.setName('questions').setDescription('The questions of a form, in order.').addStringOption(formOption))
  .addSubcommandGroup((g) => g.setName('question').setDescription('Add, change, move or remove the questions of a form.')
    .addSubcommand((s) => s.setName('add').setDescription('Add a question at the end.')
      .addStringOption(formOption)
      .addStringOption((o) => o.setName('type').setDescription('short, paragraph, number, yesno, choice or multi').setRequired(true).addChoices(...forms.QUESTION_TYPES.map((name) => ({ name, value: name }))))
      .addStringOption((o) => o.setName('label').setDescription('The question (45 characters)').setRequired(true).setMaxLength(45))
      .addBooleanOption((o) => o.setName('required').setDescription('Whether an answer is needed (yes by default)').setRequired(false))
      .addStringOption((o) => o.setName('help').setDescription('A line under the question (100 characters)').setRequired(false).setMaxLength(100))
      .addStringOption((o) => o.setName('description').setDescription('A longer text under the question on the web (1000 characters)').setRequired(false).setMaxLength(1000))
      .addStringOption((o) => o.setName('image').setDescription('An image over the question on the web: an https link to a png, jpg, gif or webp').setRequired(false).setMaxLength(500))
      .addStringOption((o) => o.setName('placeholder').setDescription('The grey text in the empty field (100 characters)').setRequired(false).setMaxLength(100))
      .addNumberOption((o) => o.setName('min').setDescription('Least characters, or the lowest number').setRequired(false))
      .addNumberOption((o) => o.setName('max').setDescription('Most characters, or the highest number').setRequired(false))
      .addStringOption((o) => o.setName('options').setDescription('For choice and multi: the options, separated by |').setRequired(false))
      .addIntegerOption((o) => o.setName('choices').setDescription('For multi: how many options can be picked').setRequired(false).setMinValue(1).setMaxValue(25)))
    .addSubcommand((s) => s.setName('edit').setDescription('Change one thing of a question.')
      .addStringOption(formOption)
      .addIntegerOption((o) => o.setName('position').setDescription('The number of the question').setRequired(true).setMinValue(1).setMaxValue(25))
      .addStringOption((o) => o.setName('field').setDescription('What to change').setRequired(true).addChoices(...QUESTION_FIELDS.map((name) => ({ name, value: name }))))
      .addStringOption((o) => o.setName('value').setDescription('The new value ("none" clears it)').setRequired(true)))
    .addSubcommand((s) => s.setName('move').setDescription('Move a question to another place.')
      .addStringOption(formOption)
      .addIntegerOption((o) => o.setName('from').setDescription('Its number now').setRequired(true).setMinValue(1).setMaxValue(25))
      .addIntegerOption((o) => o.setName('to').setDescription('Its new number').setRequired(true).setMinValue(1).setMaxValue(25)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove a question.')
      .addStringOption(formOption)
      .addIntegerOption((o) => o.setName('position').setDescription('The number of the question').setRequired(true).setMinValue(1).setMaxValue(25))))
  .addSubcommand((s) => s.setName('panel').setDescription('Post the buttons (or a menu) that open one or more forms.')
    .addChannelOption((o) => o.setName('channel').setDescription('Where to post it').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
    .addStringOption((o) => o.setName('forms').setDescription('The forms, separated by spaces or commas').setRequired(true))
    .addStringOption((o) => o.setName('style').setDescription('Buttons or a menu').setRequired(false).addChoices({ name: 'buttons', value: 'buttons' }, { name: 'select', value: 'select' }))
    .addStringOption((o) => o.setName('template').setDescription('A saved embed to post the buttons under').setRequired(false))
    .addStringOption((o) => o.setName('title').setDescription('A title for the panel').setRequired(false).setMaxLength(200))
    .addStringOption((o) => o.setName('description').setDescription('The text of the panel').setRequired(false).setMaxLength(2000))
    .addBooleanOption((o) => o.setName('web').setDescription('Also a "Fill on the web" link button (--web yes)').setRequired(false)))
  .addSubcommand((s) => s.setName('retention').setDescription('How many days the answers of reviewed submissions are kept (30 by default).')
    .addIntegerOption((o) => o.setName('days').setDescription('1 to 365; empty shows the current one').setRequired(false).setMinValue(1).setMaxValue(365)))
  .addSubcommand((s) => s.setName('submissions').setDescription('What members sent, newest first.')
    .addStringOption((o) => o.setName('form').setDescription('Only this form').setRequired(false))
    .addStringOption((o) => o.setName('status').setDescription('pending, accepted, denied or cancelled').setRequired(false).addChoices(...forms.STATUSES.map((name) => ({ name, value: name })))))
  .addSubcommand((s) => s.setName('view').setDescription('Read a submission, with its buttons.')
    .addIntegerOption((o) => o.setName('number').setDescription('The number of the submission').setRequired(true).setMinValue(1)))
  .addSubcommand((s) => s.setName('accept').setDescription('Accept a submission: its roles are given and the member is told.')
    .addIntegerOption((o) => o.setName('number').setDescription('The number of the submission').setRequired(true).setMinValue(1))
    .addStringOption((o) => o.setName('reason').setDescription('Why (the member reads it)').setRequired(false).setMaxLength(1000)))
  .addSubcommand((s) => s.setName('deny').setDescription('Deny a submission: the member is told.')
    .addIntegerOption((o) => o.setName('number').setDescription('The number of the submission').setRequired(true).setMinValue(1))
    .addStringOption((o) => o.setName('reason').setDescription('Why (the member reads it)').setRequired(false).setMaxLength(1000)));

const MANAGE = new Set(['create', 'delete', 'info', 'open', 'close', 'relink', 'set', 'message', 'questions', 'add', 'edit', 'move', 'remove', 'panel', 'list', 'retention']);
const canManage = (member) => Boolean(member?.permissions?.has?.(PermissionFlagsBits.ManageGuild) || member?.permissions?.has?.(PermissionFlagsBits.Administrator));

async function limitsOf(guildId) {
  void guildId;
  return { forms: forms.FORM_LIMITS.forms, questions: forms.FORM_LIMITS.questions };
}

const typeName = (type, lang) => t(lang, `forms.type.${type}`);
const roleList = (list, lang) => (list?.length ? list.map((id) => `<@&${id}>`).join(' ') : t(lang, 'forms.info.none'));
const onOff = (value, lang) => t(lang, value ? 'forms.info.on' : 'forms.info.off');

function questionLine(q, index, lang) {
  const extras = [typeName(q.type, lang), t(lang, q.required ? 'forms.questions.required' : 'forms.questions.optional')];
  if (q.type === 'short' || q.type === 'paragraph') extras.push(`${q.min_length}–${q.max_length}`);
  if (q.type === 'number' && (q.min_value !== null || q.max_value !== null)) extras.push(`${q.min_value ?? '…'}–${q.max_value ?? '…'}`);
  if (q.options) extras.push(q.options.join(' | ').slice(0, 200));
  const lines = [`**${index + 1}.** ${q.label}`, `-# ${extras.join(' · ')}`];
  if (q.help) lines.push(`-# ${q.help}`);
  if (q.description) {
    const plain = forms.plainDescription(q.description);
    lines.push(`-# ${t(lang, 'forms.questions.description', { text: plain.length > 100 ? `${plain.slice(0, 99)}…` : plain })}`);
  }
  if (q.image) lines.push(`-# ${t(lang, 'forms.questions.image', { host: new URL(q.image).hostname })}`);
  return lines.join('\n');
}

/** Reads a list of roles: mentions, ids or names, separated by spaces or commas. */
function readRoles(guild, text) {
  const roles = [];
  const unknown = [];
  for (const token of String(text ?? '').split(/[\s,]+/).filter(Boolean)) {
    const role = resolveRole(guild, token);
    if (role && role.id !== guild.id) roles.push(role.id); else unknown.push(token);
  }
  return { roles: [...new Set(roles)].slice(0, forms.LIMITS.roles), unknown };
}

/** A number of days or hours: `7`, `7d`, `2 weeks`, `36h`. `unitMs` is what a plain number means. */
function readAmount(text, unitMs, max) {
  const raw = String(text ?? '').trim().toLowerCase();
  if (/^\d{1,6}$/.test(raw)) return Math.min(max, Number(raw));
  if (!unitMs) return null;
  const span = parseDuration(raw);
  return span ? Math.min(max, Math.round(span / unitMs)) : null;
}

/** The change one `!form set` makes, or { error } with the sentence to show. */
function settingChange(guild, setting, value, lang) {
  const text = String(value ?? '').trim();
  const off = isOff(text);
  if (setting === 'title') return off || !text ? { error: t(lang, 'forms.set.titleEmpty') } : { title: forms.clip(text, forms.LIMITS.title) };
  if (setting === 'description') return { description: off ? null : forms.clip(text, forms.LIMITS.description) };
  if (setting === 'color') {
    if (off) return { color: null };
    const hex = /^#?([0-9a-f]{6})$/i.exec(text);
    return hex ? { color: parseInt(hex[1], 16) } : { error: t(lang, 'forms.set.color') };
  }
  if (setting === 'channel') {
    if (off) return { review_channel_id: null };
    const id = text.replace(/[<#>]/g, '');
    const channel = guild.channels.cache.get(id) ?? guild.channels.cache.find((c) => c.name.toLowerCase() === text.replace(/^#/, '').toLowerCase());
    return channel?.isTextBased?.() ? { review_channel_id: channel.id } : { error: t(lang, 'forms.set.channel') };
  }
  if (ROLE_SETTINGS[setting]) {
    if (off) return { [ROLE_SETTINGS[setting]]: [] };
    const { roles, unknown } = readRoles(guild, text);
    if (unknown.length) return { error: t(lang, 'forms.set.unknownRoles', { roles: unknown.join(', ') }) };
    return { [ROLE_SETTINGS[setting]]: setting === 'ping' ? roles.slice(0, 5) : roles };
  }
  if (SWITCHES[setting]) {
    const word = text.toLowerCase();
    if (ON.includes(word)) return { [SWITCHES[setting]]: true };
    if (OFF.includes(word) || off) return { [SWITCHES[setting]]: false };
    return { error: t(lang, 'forms.set.switch') };
  }
  if (NUMBERS[setting]) {
    const [column, max, unit] = NUMBERS[setting];
    if (off) return { [column]: 0 };
    const amount = readAmount(text, unit, max);
    return amount === null ? { error: t(lang, 'forms.set.number') } : { [column]: amount };
  }
  if (setting === 'closes') {
    if (off) return { closes_at: null };
    const span = /^\d{4}-\d{2}-\d{2}/.test(text) ? null : parseDuration(text);
    const at = span ? Date.now() + span : Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T23:59:59Z` : text);
    return Number.isFinite(at) && at > Date.now() ? { closes_at: new Date(at).toISOString() } : { error: t(lang, 'forms.set.closes') };
  }
  if (setting === 'button-label') return { button_label: off ? null : forms.clip(text, forms.LIMITS.buttonLabel) };
  if (setting === 'button-emoji') return { button_emoji: off ? null : forms.clip(text, 64) };
  if (setting === 'button-style') return forms.BUTTON_STYLES.includes(text.toLowerCase()) ? { button_style: text.toLowerCase() } : { error: t(lang, 'forms.set.style') };
  return { error: t(lang, 'forms.set.unknown', { settings: SETTINGS.join(', ') }) };
}

/** A question changed by `!form question edit`, checked like a new one; { error } when it cannot be asked like that. */
function questionChange(question, field, value, lang) {
  const text = String(value ?? '').trim();
  const off = isOff(text);
  const next = { ...question };
  if (field === 'label') next.label = text;
  else if (field === 'type') { const type = TYPE_WORDS[text.toLowerCase()]; if (!type) return { error: t(lang, 'forms.question.type') }; next.type = type; }
  else if (field === 'help') next.help = off ? null : text;
  else if (field === 'description') next.description = off ? null : String(value ?? '');
  else if (field === 'image') { if (!off && !forms.imageUrl(text)) return { error: t(lang, 'forms.question.image') }; next.image = off ? null : text; }
  else if (field === 'placeholder') next.placeholder = off ? null : text;
  else if (field === 'required') { const word = text.toLowerCase(); if (!ON.includes(word) && !OFF.includes(word)) return { error: t(lang, 'forms.set.switch') }; next.required = ON.includes(word); }
  else if (field === 'min' || field === 'max') {
    const n = off ? null : Number(text.replace(',', '.'));
    if (n !== null && !Number.isFinite(n)) return { error: t(lang, 'forms.set.number') };
    if (question.type === 'number') next[field === 'min' ? 'min_value' : 'max_value'] = n;
    else next[field === 'min' ? 'min_length' : 'max_length'] = n;
  } else if (field === 'options') next.options = text.split('|');
  else if (field === 'choices') next.max_choices = off ? null : Number(text);
  else return { error: t(lang, 'forms.question.field', { fields: QUESTION_FIELDS.join(', ') }) };
  const clean = forms.normalizeQuestion(next, 0, new Set());
  if (!clean) return { error: t(lang, forms.CHOICE_TYPES.includes(next.type) ? 'forms.question.options' : 'forms.question.label') };
  return { question: { ...clean, id: question.id } };
}

async function infoText(guild, form, lang) {
  const [pending, all] = await Promise.all([formsDb.listSubmissions(guild.id, { formId: form.id, status: 'pending', limit: 200 }), formsDb.countFormSubmissions(guild.id, form.id)]);
  const questions = forms.normalizeQuestions(form.questions);
  const messageState = (key) => {
    const own = form.messages?.[key] ?? {};
    if (own.template) return t(lang, 'forms.info.messageEmbed', { name: own.template });
    return t(lang, own.text ? 'forms.info.messageOwn' : 'forms.info.messageDefault');
  };
  return [
    `## ${form.title}`,
    t(lang, 'forms.info.head', { name: form.name, id: form.id, state: t(lang, form.status === 'open' ? 'forms.info.open' : 'forms.info.closed') }),
    form.description ? `> ${forms.clip(form.description, 300).replace(/\n/g, '\n> ')}` : null,
    t(lang, form.web_enabled === false ? 'forms.info.webOff' : 'forms.info.web', { url: forms.webUrl(form, lang), name: form.name }),
    `### ${t(lang, 'forms.info.review')}`,
    t(lang, 'forms.info.channel', { channel: form.review_channel_id ? `<#${form.review_channel_id}>` : t(lang, 'forms.info.notSet') }),
    t(lang, 'forms.info.reviewers', { roles: form.reviewer_role_ids?.length ? roleList(form.reviewer_role_ids, lang) : t(lang, 'forms.info.managers') }),
    t(lang, 'forms.info.ping', { roles: roleList(form.ping_role_ids, lang) }),
    t(lang, 'forms.info.thread', { state: onOff(form.auto_thread, lang) }),
    `### ${t(lang, 'forms.info.rules')}`,
    t(lang, 'forms.info.required', { roles: roleList(form.required_role_ids, lang) }),
    t(lang, 'forms.info.blocked', { roles: roleList(form.blocked_role_ids, lang) }),
    t(lang, 'forms.info.ages', { account: form.min_account_days, server: form.min_member_days }),
    t(lang, 'forms.info.limits', { pending: onOff(form.one_pending, lang), cooldown: form.deny_cooldown_hours, perUser: form.max_per_user || '∞', total: form.max_total || '∞' }),
    t(lang, 'forms.info.closes', { time: form.closes_at ? `<t:${unix(form.closes_at)}:f>` : t(lang, 'forms.info.never') }),
    `### ${t(lang, 'forms.info.results')}`,
    t(lang, 'forms.info.accept', { add: roleList(form.accept_add_role_ids, lang), remove: roleList(form.accept_remove_role_ids, lang) }),
    t(lang, 'forms.info.deny', { add: roleList(form.deny_add_role_ids, lang), remove: roleList(form.deny_remove_role_ids, lang) }),
    t(lang, 'forms.info.dm', { state: onOff(form.dm_results, lang) }),
    t(lang, 'forms.info.messages', { submitted: messageState('submitted'), accepted: messageState('accepted'), denied: messageState('denied') }),
    `### ${t(lang, 'forms.info.numbers')}`,
    t(lang, 'forms.info.counts', { questions: questions.length, pages: forms.pagesOf(form).length, pending: pending.length, total: all }),
  ].filter((line) => line !== null).join('\n');
}

async function findForm(interaction, lang, done) {
  const ref = interaction.options.getString('form', true);
  const form = await formsDb.getForm(interaction.guild.id, ref);
  if (!form) { await done(bad(t(lang, 'forms.notFound', { form: forms.clip(ref, 40) }))); return null; }
  return form;
}

async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const lang = await languageOf(interaction);
  const done = (component, extra = {}) => interaction.editReply({ components: [component], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] }, ...extra });
  const guild = interaction.guild;
  const sub = interaction.options.getSubcommand();
  const group = interaction.options.getSubcommandGroup(false);
  if (MANAGE.has(sub) && !canManage(interaction.member)) return done(bad(t(lang, 'forms.needManage')));
  await ensureGuild(guild.id);

  if (sub === 'create') {
    const name = forms.slugName(interaction.options.getString('name', true));
    if (!forms.NAME.test(name)) return done(bad(t(lang, 'forms.create.badName')));
    const limits = await limitsOf(guild.id);
    const count = await formsDb.countForms(guild.id);
    if (count >= limits.forms) return done(bad(t(lang, 'forms.create.limit', { count: limits.forms })));
    if (await formsDb.getForm(guild.id, name)) return done(bad(t(lang, 'forms.create.taken', { name })));
    const title = interaction.options.getString('title') || name;
    const form = await formsDb.createForm(guild.id, { ...forms.normalizeForm({ name, title, status: 'closed' }), public_id: forms.newPublicId() });
    return done(ok(t(lang, 'forms.create.done', { name: form.name, title: form.title })));
  }

  if (sub === 'list') {
    const list = await formsDb.listForms(guild.id);
    if (!list.length) return done(note(t(lang, 'forms.list.none')));
    const pending = await formsDb.listSubmissions(guild.id, { status: 'pending', limit: 200 });
    const limits = await limitsOf(guild.id);
    const lines = list.map((form) => t(lang, 'forms.list.line', {
      name: form.name, title: form.title, state: t(lang, form.status === 'open' ? 'forms.info.open' : 'forms.info.closed'),
      questions: forms.normalizeQuestions(form.questions).length, pending: pending.filter((row) => String(row.form_id) === String(form.id)).length,
    }));
    return done(note([`### ${t(lang, 'forms.list.title', { count: list.length, max: limits.forms })}`, ...lines].join('\n')));
  }

  if (sub === 'retention') {
    const days = interaction.options.getInteger('days');
    if (days !== null && (days < 1 || days > 365)) return done(bad(t(lang, 'forms.retention.range')));
    const setting = days !== null ? await formsDb.setFormConfig(guild.id, { retention_days: days }) : await formsDb.getFormConfig(guild.id);
    const [stored, cap] = await Promise.all([formsDb.countStored(guild.id), actions.storageCap(guild.id)]);
    const lines = [t(lang, days !== null ? 'forms.retention.set' : 'forms.retention.show', { days: setting.retention_days }), t(lang, 'forms.retention.stored', { count: stored.total, max: cap, pending: stored.pending })];
    return done(days !== null ? ok(lines.join('\n')) : note(lines.join('\n')));
  }

  if (sub === 'submissions') {
    let ref = interaction.options.getString('form');
    let statusWord = interaction.options.getString('status');
    let form = ref ? await formsDb.getForm(guild.id, ref) : null;
    // `!form submissions denied`: a state written where the form goes, when no form has that name.
    if (ref && !form && !statusWord && (STATUS_WORDS[ref.toLowerCase()] || ref.toLowerCase() === 'all')) { statusWord = ref; ref = null; form = null; }
    if (ref && !form) return done(bad(t(lang, 'forms.notFound', { form: forms.clip(ref, 40) })));
    if (form && !forms.isReviewer(interaction.member, form)) return done(bad(t(lang, 'forms.review.notReviewer')));
    const rawStatus = (statusWord ?? 'pending').toLowerCase();
    const status = rawStatus === 'all' ? null : STATUS_WORDS[rawStatus];
    if (rawStatus !== 'all' && !status) return done(bad(t(lang, 'forms.submissions.status')));
    let rows = await formsDb.listSubmissions(guild.id, { formId: form?.id ?? null, status, limit: 60 });
    if (!form && !canManage(interaction.member)) {
      const all = await formsDb.listForms(guild.id);
      const mine = new Set(all.filter((f) => forms.isReviewer(interaction.member, f)).map((f) => String(f.id)));
      if (!mine.size) return done(bad(t(lang, 'forms.review.notReviewer')));
      rows = rows.filter((row) => mine.has(String(row.form_id)));
    }
    rows = rows.slice(0, 15);
    if (!rows.length) return done(note(t(lang, 'forms.submissions.none')));
    const lines = rows.map((row) => {
      const link = row.channel_id && row.message_id ? ` · [${t(lang, 'forms.submissions.card')}](https://discord.com/channels/${guild.id}/${row.channel_id}/${row.message_id})` : ''; // i18n-ignore: a link around the translated word
      return `**#${row.number}** · <@${row.user_id}> · ${forms.clip(row.form_title || row.form_name, 40)} · ${t(lang, `forms.status.${row.status}`)} · <t:${unix(row.created_at)}:R>${link}`;
    });
    return done(note([`### ${t(lang, 'forms.submissions.title', { status: status ? t(lang, `forms.status.${status}`) : t(lang, 'forms.submissions.all') })}`, ...lines].join('\n')));
  }

  if (sub === 'view' || sub === 'accept' || sub === 'deny') {
    const number = interaction.options.getInteger('number', true);
    const submission = await formsDb.getSubmission(guild.id, number);
    if (!submission) return done(bad(t(lang, 'forms.review.gone')));
    const form = submission.form_id ? await formsDb.getForm(guild.id, submission.form_id).catch(() => null) : null;
    if (!forms.isReviewer(interaction.member, form)) return done(bad(t(lang, 'forms.review.notReviewer')));
    if (sub === 'view') {
      const member = guild.members.cache.get(submission.user_id) ?? null;
      const { container, file } = reviewCard({ submission: { ...submission, guild_id: guild.id }, form, lang, member });
      return interaction.editReply({ components: [container], files: file ? [new AttachmentBuilder(Buffer.from(forms.answersAsText(submission, lang), 'utf8'), { name: file.name })] : [], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
    }
    if (submission.status !== 'pending') return done(bad(t(lang, 'forms.review.already')));
    const result = await actions.reviewSubmission({
      client: interaction.client, guild, submission, status: sub === 'accept' ? 'accepted' : 'denied',
      reviewer: { id: interaction.user.id, name: interaction.member?.displayName ?? interaction.user.username }, reason: interaction.options.getString('reason'),
    });
    if (!result.ok) return done(bad(t(lang, 'forms.review.already')));
    const { reviewSummary } = require('../../interactions/forms');
    return done(textCard(reviewSummary(result, lang), result.submission.status === 'accepted' ? 0x23a55a : 0xf23f43));
  }

  if (sub === 'panel') {
    const channel = interaction.options.getChannel('channel', true);
    const refs = String(interaction.options.getString('forms', true)).split(/[\s,]+/).filter(Boolean);
    const found = [];
    for (const ref of refs) {
      const form = await formsDb.getForm(guild.id, ref);
      if (!form) return done(bad(t(lang, 'forms.notFound', { form: forms.clip(ref, 40) })));
      if (!found.some((f) => f.id === form.id)) found.push(form);
    }
    const template = interaction.options.getString('template');
    if (template && !(await getTemplate(guild.id, template).catch(() => null))?.data) return done(bad(t(lang, 'forms.panel.noTemplate', { name: forms.clip(template, 60) })));
    const result = await actions.postPanel({
      guild, channel, formList: found, style: (interaction.options.getString('style') ?? 'buttons').toLowerCase() === 'select' ? 'select' : 'buttons',
      template, title: interaction.options.getString('title'), description: interaction.options.getString('description'), createdBy: interaction.user.id,
      web: interaction.options.getBoolean('web') === true,
    });
    if (!result.ok) return done(bad(t(lang, `forms.panel.error.${result.error}`)));
    const closed = found.filter((f) => f.status !== 'open').map((f) => `\`${f.name}\``);
    return done(ok([t(lang, 'forms.panel.done', { link: result.message.url ?? `<#${channel.id}>` }), closed.length ? t(lang, 'forms.panel.closedNote', { forms: closed.join(', ') }) : null].filter(Boolean).join('\n')));
  }

  const form = await findForm(interaction, lang, done);
  if (!form) return undefined;

  if (sub === 'delete') {
    await formsDb.deleteForm(guild.id, form.id);
    return done(ok(t(lang, 'forms.delete.done', { name: form.name })));
  }
  if (sub === 'info') return done(note(await infoText(guild, form, lang)));
  if (sub === 'open' || sub === 'close') {
    if (sub === 'open') {
      const missing = [];
      if (!forms.normalizeQuestions(form.questions).length) missing.push(t(lang, 'forms.open.needQuestions', { name: form.name }));
      if (!form.review_channel_id) missing.push(t(lang, 'forms.open.needChannel', { name: form.name }));
      if (missing.length) return done(bad([t(lang, 'forms.open.notYet'), ...missing].join('\n')));
    }
    await formsDb.updateForm(guild.id, form.id, { status: sub === 'open' ? 'open' : 'closed' });
    return done(ok(t(lang, sub === 'open' ? 'forms.open.done' : 'forms.close.done', { name: form.name })));
  }
  // `!form relink staff` (or `!form set staff link new`): a new random web address; the old one stops working at once.
  const relink = async () => {
    const renewed = await formsDb.renewPublicId(guild.id, form.id);
    return done(ok(t(lang, 'forms.relink.done', { name: form.name, url: forms.webUrl(renewed ?? form, lang) })));
  };
  if (sub === 'relink') return relink();
  if (sub === 'set') {
    const setting = interaction.options.getString('setting', true).toLowerCase();
    if (setting === 'link') {
      if (!LINK_WORDS.includes(interaction.options.getString('value', true).trim().toLowerCase())) return done(bad(t(lang, 'forms.set.link', { name: form.name })));
      return relink();
    }
    const change = settingChange(guild, setting, interaction.options.getString('value', true), lang);
    if (change.error) return done(bad(change.error));
    await formsDb.updateForm(guild.id, form.id, change);
    return done(ok(t(lang, 'forms.set.done', { setting, name: form.name })));
  }
  if (sub === 'message') {
    const kind = interaction.options.getString('kind', true).toLowerCase();
    if (!['submitted', 'accepted', 'denied'].includes(kind)) return done(bad(t(lang, 'forms.message.kind')));
    const text = interaction.options.getString('text');
    const template = (interaction.options.getString('template') ?? '').trim();
    const current = { ...(form.messages?.[kind] ?? {}) };
    if (text === null && !template) {
      const shown = current.text || t(lang, kind === 'submitted' ? 'forms.submitted' : `forms.result.${kind}`, { form: form.title, server: guild.name, number: 12 });
      return done(note(current.template ? t(lang, 'forms.message.showEmbed', { name: current.template, text: shown }) : t(lang, 'forms.message.show', { text: shown })));
    }
    if (text !== null) { if (isOff(text)) delete current.text; else current.text = forms.clip(text, forms.LIMITS.message); }
    if (template) {
      if (kind === 'submitted') return done(bad(t(lang, 'forms.message.noEmbedHere')));
      if (isOff(template)) delete current.template;
      else if (!(await getTemplate(guild.id, template).catch(() => null))?.data) return done(bad(t(lang, 'forms.panel.noTemplate', { name: forms.clip(template, 60) })));
      else current.template = template;
    }
    await formsDb.updateForm(guild.id, form.id, { messages: { ...(form.messages ?? {}), [kind]: current } });
    return done(ok(t(lang, 'forms.message.saved')));
  }

  const questions = forms.normalizeQuestions(form.questions);
  if (sub === 'questions') {
    if (!questions.length) return done(note(t(lang, 'forms.questions.none', { name: form.name })));
    const limits = await limitsOf(guild.id);
    const lines = questions.map((q, i) => questionLine(q, i, lang));
    const foot = `-# ${tn(lang, 'forms.questions.pages', forms.pagesOf(form).length, { count: forms.pagesOf(form).length })}`;
    const body = [`### ${t(lang, 'forms.questions.title', { title: form.title, count: questions.length, max: limits.questions })}`, ...lines].join('\n');
    // A card holds 4000 characters: with many long questions the end of the list is cut, the count of pages always shows.
    return done(note(`${body.length > 3990 - foot.length ? `${body.slice(0, 3988 - foot.length)}…` : body}\n${foot}`));
  }
  if (group === 'question') {
    const save = (list) => formsDb.updateForm(guild.id, form.id, { questions: list });
    if (sub === 'add') {
      const limits = await limitsOf(guild.id);
      if (questions.length >= limits.questions) return done(bad(t(lang, 'forms.question.limit', { count: limits.questions })));
      const type = TYPE_WORDS[String(interaction.options.getString('type', true)).toLowerCase()];
      if (!type) return done(bad(t(lang, 'forms.question.type')));
      const image = interaction.options.getString('image');
      if (image && !isOff(image) && !forms.imageUrl(image)) return done(bad(t(lang, 'forms.question.image')));
      const min = interaction.options.getNumber('min');
      const max = interaction.options.getNumber('max');
      const input = {
        id: `q${Date.now().toString(36)}`, type, label: interaction.options.getString('label', true), required: interaction.options.getBoolean('required') ?? true,
        help: interaction.options.getString('help'), description: interaction.options.getString('description'), image, placeholder: interaction.options.getString('placeholder'), options: (interaction.options.getString('options') ?? '').split('|'),
        max_choices: interaction.options.getInteger('choices'),
        ...(type === 'number' ? { min_value: min, max_value: max } : { min_length: min, max_length: max }),
      };
      const clean = forms.normalizeQuestion(input, questions.length, new Set(questions.map((q) => q.id)));
      if (!clean) return done(bad(t(lang, forms.CHOICE_TYPES.includes(type) ? 'forms.question.options' : 'forms.question.label')));
      await save([...questions, clean]);
      return done(ok(t(lang, 'forms.question.added', { position: questions.length + 1, label: clean.label, type: typeName(type, lang) })));
    }
    const position = interaction.options.getInteger(sub === 'move' ? 'from' : 'position', true);
    if (position < 1 || position > questions.length) return done(bad(t(lang, 'forms.question.position', { count: questions.length })));
    if (sub === 'remove') {
      const [gone] = questions.splice(position - 1, 1);
      await save(questions);
      return done(ok(t(lang, 'forms.question.removed', { label: gone.label })));
    }
    if (sub === 'move') {
      const to = interaction.options.getInteger('to', true);
      if (to < 1 || to > questions.length) return done(bad(t(lang, 'forms.question.position', { count: questions.length })));
      const [moved] = questions.splice(position - 1, 1);
      questions.splice(to - 1, 0, moved);
      await save(questions);
      return done(ok(t(lang, 'forms.question.moved', { label: moved.label, position: to })));
    }
    const change = questionChange(questions[position - 1], interaction.options.getString('field', true).toLowerCase(), interaction.options.getString('value', true), lang);
    if (change.error) return done(bad(change.error));
    questions[position - 1] = change.question;
    await save(questions);
    return done(ok(t(lang, 'forms.question.edited', { position, label: change.question.label })));
  }
  return done(bad(t(lang, 'forms.unknown')));
}

module.exports = {
  prefixOnly: true,
  aliases: ['forms', 'application', 'applications'],
  // `!form edit staff title Apply` is `!form set`; `!form q add ...` is `!form question add ...`.
  prefixSubcommandAliases: { newlink: 'relink', new: 'create', edit: 'set', q: 'question', subs: 'submissions', approve: 'accept', reject: 'deny', show: 'view' },
  // The free text of these runs to the end of the message (other options go as --name value).
  prefixGreedyStringOptions: { add: 'label', message: 'text', panel: 'forms', set: 'value', edit: 'value', accept: 'reason', deny: 'reason' },
  data,
  execute,
  settingChange,
  questionChange,
  SETTINGS,
};
