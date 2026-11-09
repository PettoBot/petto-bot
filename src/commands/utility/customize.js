// /customize: how Petto looks in this server (its nickname, avatar, banner, description and name style), from Discord and not only from the Customize page of the
// dashboard. The same things the page changes, in the same way: the server profile of the bot in Discord (`PATCH /guilds/{id}/members/@me`) and the copy of it in
// the `guilds` table. The nickname is free; the rest needs Premium. A command of its own, registered in each server (the second set of slash commands).
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const database = require('../../db/database');
const { ensureGuild } = require('../../db/guilds');
const { getGuildPremium } = require('../../db/premium');
const { fetchImageBuffer } = require('../../utils/safeImage');
const { imageDimensions } = require('../../utils/imageInput');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { COLORS } = require('../../utils/colors');
const { t, languageOf } = require('../../i18n');

const IMAGE_LIMIT_BYTES = 8 * 1024 * 1024;
const DESCRIPTION_MAX = 190;
const NICKNAME_MAX = 32;

// The fonts and effects Discord has for a display name, with the ids it uses (the same list as the Customize page of the dashboard).
const FONTS = [['gg sans', 11], ['Tempo', 12], ['Sakura', 3], ['Jellybean', 4], ['Modern', 6], ['Medieval', 7], ['8bit', 8], ['Vampyre', 10]];
const EFFECTS = [['Solid', 1, 1], ['Gradient', 2, 2], ['Neon', 3, 1], ['Toon', 4, 1], ['Pop', 5, 1], ['Glow', 6, 1]];
const FIELDS = ['nickname', 'avatar', 'banner', 'description', 'namestyle'];
const PREMIUM_FIELDS = new Set(['avatar', 'banner', 'description', 'namestyle']);

const hexToInt = (hex) => (/^#?[0-9a-f]{6}$/i.test(String(hex ?? '').trim()) ? parseInt(String(hex).trim().replace('#', ''), 16) : null);

const reply = (interaction, text, color = COLORS.DEFAULT) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });

/** The body of the member endpoint for a name style (or for no style: ids at 0 and no colors). */
function nameStyleBody(style) {
  return style
    ? { display_name_font_id: style.fontId, display_name_effect_id: style.effectId, display_name_colors: style.colors }
    : { display_name_font_id: 0, display_name_effect_id: 0, display_name_colors: [] };
}

/** An attachment as the data URI Discord takes for an avatar or banner. Throws `'bad'` for anything that is not a PNG, JPG, GIF or WebP of at most 8 MB. */
async function attachmentToDataUri(attachment, fetchImage = fetchImageBuffer) {
  if (!attachment?.url) throw new Error('bad');
  let buffer;
  try {
    buffer = await fetchImage(attachment.url, undefined, { maxBytes: IMAGE_LIMIT_BYTES });
  } catch {
    throw new Error('bad');
  }
  const info = imageDimensions(buffer);
  if (!info || buffer.length > IMAGE_LIMIT_BYTES) throw new Error('bad');
  return `data:image/${info.type};base64,${buffer.toString('base64')}`;
}

/** What each field changes: the body sent to Discord and the columns saved with it. */
function planFor(field, value) {
  if (field === 'nickname') return { discord: { nick: value || null }, columns: { bot_nickname: value || null }, style: false };
  if (field === 'avatar') return { discord: { avatar: value ?? null }, columns: { bot_avatar_url: value ? 'discord' : null }, style: false };
  if (field === 'banner') return { discord: { banner: value ?? null }, columns: { bot_banner_url: value ? 'discord' : null }, style: false };
  if (field === 'description') return { discord: { bio: value || null }, columns: { bot_description: value || null }, style: false };
  return { discord: nameStyleBody(value ?? null), columns: { bot_name_style: value ?? null }, style: true };
}

async function apply(interaction, field, value) {
  const plan = planFor(field, value);
  await interaction.client.rest.patch(`/guilds/${interaction.guild.id}/members/@me`, { body: plan.discord });
  const { error } = await database.from('guilds').upsert({ guild_id: interaction.guild.id, ...plan.columns, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' });
  if (error) throw error;
}

module.exports = {
  registerSlash: true,
  guildScoped: true,
  data: new SlashCommandBuilder()
    .setName('customize')
    .setDescription('Change how Petto looks in this server: its nickname, avatar, banner, description and name style.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('nickname').setDescription("Change Petto's nickname in this server (leave it empty to go back to the default).")
      .addStringOption((o) => o.setName('name').setDescription('The new nickname').setMaxLength(NICKNAME_MAX).setRequired(false)))
    .addSubcommand((s) => s.setName('avatar').setDescription("Change Petto's avatar in this server (Premium).")
      .addAttachmentOption((o) => o.setName('image').setDescription('A PNG, JPG, GIF or WebP picture of at most 8 MB').setRequired(true)))
    .addSubcommand((s) => s.setName('banner').setDescription("Change Petto's banner in this server (Premium).")
      .addAttachmentOption((o) => o.setName('image').setDescription('A PNG, JPG, GIF or WebP picture of at most 8 MB').setRequired(true)))
    .addSubcommand((s) => s.setName('description').setDescription("Change Petto's \"about me\" in this server (Premium; leave it empty to go back to the default).")
      .addStringOption((o) => o.setName('text').setDescription('The new description').setMaxLength(DESCRIPTION_MAX).setRequired(false)))
    .addSubcommand((s) => s.setName('namestyle').setDescription("Change the font, effect and colors of Petto's name in this server (Premium).")
      .addStringOption((o) => o.setName('effect').setDescription('How the name looks').setRequired(true).addChoices(...EFFECTS.map(([name, value]) => ({ name, value: String(value) }))))
      .addStringOption((o) => o.setName('color').setDescription('A color like #ff91c2').setRequired(true))
      .addStringOption((o) => o.setName('font').setDescription('The font of the name').setRequired(false).addChoices(...FONTS.map(([name, value]) => ({ name, value: String(value) }))))
      .addStringOption((o) => o.setName('second-color').setDescription('The second color (only the Gradient effect uses it)').setRequired(false)))
    .addSubcommand((s) => s.setName('reset').setDescription('Go back to the default look of Petto: one thing, or all of it.')
      .addStringOption((o) => o.setName('field').setDescription('What to reset').setRequired(true).addChoices(...FIELDS.map((value) => ({ name: value, value })), { name: 'all', value: 'all' })))
    .addSubcommand((s) => s.setName('view').setDescription("Show how Petto's look in this server is set.")),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    await ensureGuild(interaction.guild.id);
    const fieldName = (field) => t(lang, `customize.field.${field}`);
    const failed = (colorKey = 'customize.refused') => reply(interaction, t(lang, colorKey, { emoji: EMOJI.DENY }), COLORS.RED);

    if (sub === 'view') {
      const { data } = await database.from('guilds').select('bot_nickname,bot_avatar_url,bot_banner_url,bot_description,bot_name_style').eq('guild_id', interaction.guild.id).maybeSingle();
      const row = data ?? {};
      const state = (value) => (value ? t(lang, 'customize.view.custom') : t(lang, 'customize.view.default'));
      const lines = [
        `${fieldName('nickname')}: ${row.bot_nickname ? `**${row.bot_nickname}**` : state(false)}`,
        `${fieldName('avatar')}: ${state(row.bot_avatar_url)}`,
        `${fieldName('banner')}: ${state(row.bot_banner_url)}`,
        `${fieldName('description')}: ${row.bot_description ? `*${row.bot_description}*` : state(false)}`,
        `${fieldName('namestyle')}: ${state(row.bot_name_style)}`,
      ];
      return reply(interaction, `${t(lang, 'customize.view.title')}\n${lines.map((line) => `- ${line}`).join('\n')}`);
    }

    const target = sub === 'reset' ? interaction.options.getString('field', true) : sub;
    const targets = target === 'all' ? FIELDS : [target];
    // The nickname is free; everything else needs Premium (also when it is a reset, like the dashboard).
    if (targets.some((field) => PREMIUM_FIELDS.has(field))) {
      const premium = await getGuildPremium(interaction.guild.id).catch(() => ({ active: false }));
      if (!premium.active) return reply(interaction, t(lang, 'customize.premium', { emoji: EMOJI.DENY }), COLORS.RED);
    }

    try {
      if (sub === 'reset') {
        for (const field of targets) await apply(interaction, field, null);
        return reply(interaction, t(lang, 'customize.done.reset', { emoji: EMOJI.APPROVE, field: target === 'all' ? t(lang, 'customize.field.all') : fieldName(target) }), COLORS.GREEN);
      }
      if (sub === 'nickname') {
        const name = (interaction.options.getString('name') ?? '').trim().slice(0, NICKNAME_MAX);
        await apply(interaction, 'nickname', name);
        return reply(interaction, t(lang, name ? 'customize.done.set' : 'customize.done.reset', { emoji: EMOJI.APPROVE, field: fieldName('nickname') }), COLORS.GREEN);
      }
      if (sub === 'description') {
        const text = (interaction.options.getString('text') ?? '').replace(/\r\n/g, '\n').trim().slice(0, DESCRIPTION_MAX);
        await apply(interaction, 'description', text);
        return reply(interaction, t(lang, text ? 'customize.done.set' : 'customize.done.reset', { emoji: EMOJI.APPROVE, field: fieldName('description') }), COLORS.GREEN);
      }
      if (sub === 'avatar' || sub === 'banner') {
        let uri;
        try { uri = await attachmentToDataUri(interaction.options.getAttachment('image', true)); } catch { return reply(interaction, t(lang, 'customize.image.bad', { emoji: EMOJI.DENY }), COLORS.RED); }
        await apply(interaction, sub, uri);
        return reply(interaction, t(lang, 'customize.done.set', { emoji: EMOJI.APPROVE, field: fieldName(sub) }), COLORS.GREEN);
      }
      if (sub === 'namestyle') {
        const effect = EFFECTS.find(([, id]) => String(id) === interaction.options.getString('effect', true));
        const font = FONTS.find(([, id]) => String(id) === (interaction.options.getString('font') ?? '11')) ?? FONTS[0];
        const colors = [hexToInt(interaction.options.getString('color', true))];
        if (effect[2] === 2) colors.push(hexToInt(interaction.options.getString('second-color') ?? ''));
        if (colors.some((color) => color === null)) return reply(interaction, t(lang, 'customize.style.colors', { emoji: EMOJI.DENY, count: effect[2] }), COLORS.RED);
        await apply(interaction, 'namestyle', { fontId: font[1], effectId: effect[1], colors });
        return reply(interaction, t(lang, 'customize.done.set', { emoji: EMOJI.APPROVE, field: fieldName('namestyle') }), COLORS.GREEN);
      }
    } catch {
      return failed();
    }
    return undefined;
  },
};

module.exports.attachmentToDataUri = attachmentToDataUri;
module.exports.planFor = planFor;
module.exports.nameStyleBody = nameStyleBody;
