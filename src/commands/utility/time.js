const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { COLORS } = require('../../utils/colors');

const COUNTRY_ZONES = new Map([
  ['colombia', 'America/Bogota'], ['mexico', 'America/Mexico_City'], ['el_salvador', 'America/El_Salvador'], ['salvador', 'America/El_Salvador'],
  ['guatemala', 'America/Guatemala'], ['honduras', 'America/Tegucigalpa'], ['nicaragua', 'America/Managua'], ['costa_rica', 'America/Costa_Rica'],
  ['panama', 'America/Panama'], ['venezuela', 'America/Caracas'], ['peru', 'America/Lima'], ['ecuador', 'America/Guayaquil'], ['bolivia', 'America/La_Paz'],
  ['chile', 'America/Santiago'], ['argentina', 'America/Argentina/Buenos_Aires'], ['uruguay', 'America/Montevideo'], ['paraguay', 'America/Asuncion'],
  ['brasil', 'America/Sao_Paulo'], ['brazil', 'America/Sao_Paulo'], ['espana', 'Europe/Madrid'], ['spain', 'Europe/Madrid'],
  ['estados_unidos', 'America/New_York'], ['usa', 'America/New_York'], ['canada', 'America/Toronto'], ['reino_unido', 'Europe/London'], ['uk', 'Europe/London'],
  ['francia', 'Europe/Paris'], ['france', 'Europe/Paris'], ['alemania', 'Europe/Berlin'], ['germany', 'Europe/Berlin'], ['italia', 'Europe/Rome'], ['italy', 'Europe/Rome'],
  ['japon', 'Asia/Tokyo'], ['japan', 'Asia/Tokyo'], ['corea', 'Asia/Seoul'], ['korea', 'Asia/Seoul'], ['india', 'Asia/Kolkata'], ['china', 'Asia/Shanghai'],
  ['australia', 'Australia/Sydney'],
]);

function normalizeZoneInput(value) {
  return String(value ?? '').trim().toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s-]+/g, '_');
}

function resolveTimezone(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { zone: 'UTC', label: 'UTC' };
  const zone = COUNTRY_ZONES.get(normalizeZoneInput(raw)) ?? raw;
  return { zone, label: zone === raw ? raw : `${raw} · ${zone}` };
}

function formatTime(zone) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'long', timeZone: zone }).format(new Date());
}

module.exports = {
  aliases: ['tz', 'clock'],
  data: new SlashCommandBuilder()
    .setName('time')
    .setDescription('Show the current time in a time zone.')
    .addStringOption((option) => option.setName('timezone').setDescription('IANA zone, for example Europe/Madrid or America/El_Salvador').setRequired(false)),

  async execute(interaction) {
    const requested = interaction.options.getString('timezone')?.trim() || 'UTC';
    const { zone, label } = resolveTimezone(requested);
    let value;
    try {
      value = formatTime(zone);
    } catch {
      await interaction.reply({ content: 'That country or time zone is not valid. Try `Colombia`, `Mexico`, `America/Bogota`, or `Europe/Madrid`.' });
      return;
    }

    const unix = Math.floor(Date.now() / 1000);
    const embed = new EmbedBuilder()
      .setColor(COLORS.DEFAULT)
      .setTitle(`Current time · ${label}`)
      .setDescription(`**${value}**\n<t:${unix}:F>\n<t:${unix}:R>`)
      .setFooter({ text: `Time zone: ${zone}` });
    await interaction.reply({ embeds: [embed] });
  },
};
