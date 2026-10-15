const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { COLORS } = require('../../utils/colors');
const { t, languageOf } = require('../../i18n');

// The WMO weather codes Open-Meteo answers with; each one is named in `utility.weather.code.<code>`.
const WEATHER_CODES = new Set([0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]);

module.exports = {
  aliases: ['clima', 'meteo'],
  data: new SlashCommandBuilder()
    .setName('weather')
    .setDescription('Show current weather for a city or country.')
    .addStringOption((option) => option.setName('place').setDescription('City or country, for example San Salvador or Colombia').setRequired(true)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const place = interaction.options.getString('place', true).trim();
    await interaction.deferReply({ flags: MessageFlags.SuppressNotifications });

    try {
      const location = await geocode(place);
      if (!location) {
        await interaction.editReply({ content: t(lang, 'utility.weather.notFound', { place }) });
        return;
      }

      const weather = await currentWeather(location.latitude, location.longitude);
      const unit = weather.temperature_unit === 'fahrenheit' ? '°F' : '°C';
      const windUnit = weather.wind_speed_unit === 'mph' ? 'mph' : 'km/h';
      const embed = new EmbedBuilder()
        .setColor(COLORS.DEFAULT)
        .setTitle(t(lang, 'utility.weather.title', { place: `${location.name}${location.country ? `, ${location.country}` : ''}` }))
        .setDescription(`**${t(lang, WEATHER_CODES.has(weather.weather_code) ? `utility.weather.code.${weather.weather_code}` : 'utility.weather.current')}**`)
        .addFields(
          { name: t(lang, 'utility.weather.temperature'), value: `${Math.round(weather.temperature_2m)}${unit}`, inline: true },
          { name: t(lang, 'utility.weather.feelsLike'), value: `${Math.round(weather.apparent_temperature)}${unit}`, inline: true },
          { name: t(lang, 'utility.weather.wind'), value: `${Math.round(weather.wind_speed_10m)} ${windUnit}`, inline: true },
        )
        .setFooter({ text: t(lang, 'utility.weather.footer') });
      await interaction.editReply({ embeds: [embed] });
    } catch {
      await interaction.editReply({ content: t(lang, 'utility.weather.unavailable') });
    }
  },
};

// The search stays in English: Open-Meteo's `language` also changes which place matches a name (with `es`, "Germany"
// finds a town in the United States), so place names come back as the API writes them in English.
async function geocode(name) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en&format=json`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Geocoding failed with ${response.status}`); // i18n-ignore: internal error, execute answers with its own message
  const body = await response.json();
  const result = body.results?.[0];
  return result ? { name: result.name, country: result.country, latitude: result.latitude, longitude: result.longitude } : null;
}

async function currentWeather(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m',
    timezone: 'auto',
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Forecast failed with ${response.status}`); // i18n-ignore: internal error, execute answers with its own message
  const body = await response.json();
  return { ...body.current, ...Object.fromEntries(Object.entries(body.current_units ?? {}).map(([key, value]) => [`${key}_unit`, value])) };
}

module.exports.geocode = geocode;
