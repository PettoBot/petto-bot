const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { COLORS } = require('../../utils/colors');

const WEATHER_LABELS = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  56: 'Light freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Light freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
  77: 'Snow grains', 80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
  85: 'Light snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail',
};

module.exports = {
  aliases: ['clima', 'meteo'],
  data: new SlashCommandBuilder()
    .setName('weather')
    .setDescription('Show current weather for a city or country.')
    .addStringOption((option) => option.setName('place').setDescription('City or country, for example San Salvador or Colombia').setRequired(true)),

  async execute(interaction) {
    const place = interaction.options.getString('place', true).trim();
    await interaction.deferReply({ flags: MessageFlags.SuppressNotifications });

    try {
      const location = await geocode(place);
      if (!location) {
        await interaction.editReply({ content: `I couldn't find **${place}**. Try a city name or a country.` });
        return;
      }

      const weather = await currentWeather(location.latitude, location.longitude);
      const unit = weather.temperature_unit === 'fahrenheit' ? '°F' : '°C';
      const windUnit = weather.wind_speed_unit === 'mph' ? 'mph' : 'km/h';
      const embed = new EmbedBuilder()
        .setColor(COLORS.DEFAULT)
        .setTitle(`Weather · ${location.name}${location.country ? `, ${location.country}` : ''}`)
        .setDescription(`**${WEATHER_LABELS[weather.weather_code] ?? 'Current conditions'}**`)
        .addFields(
          { name: 'Temperature', value: `${Math.round(weather.temperature_2m)}${unit}`, inline: true },
          { name: 'Feels like', value: `${Math.round(weather.apparent_temperature)}${unit}`, inline: true },
          { name: 'Wind', value: `${Math.round(weather.wind_speed_10m)} ${windUnit}`, inline: true },
        )
        .setFooter({ text: 'Weather data from Open-Meteo. No API key required.' });
      await interaction.editReply({ embeds: [embed] });
    } catch {
      await interaction.editReply({ content: 'The weather service is unavailable right now. Try again in a moment.' });
    }
  },
};

async function geocode(name) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en&format=json`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Geocoding failed with ${response.status}`);
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
  if (!response.ok) throw new Error(`Forecast failed with ${response.status}`);
  const body = await response.json();
  return { ...body.current, ...Object.fromEntries(Object.entries(body.current_units ?? {}).map(([key, value]) => [`${key}_unit`, value])) };
}

module.exports.geocode = geocode;
