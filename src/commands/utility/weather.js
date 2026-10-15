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
      const found = await geocode(place);
      if (!found) {
        await interaction.editReply({ content: t(lang, 'utility.weather.notFound', { place }) });
        return;
      }

      const [location, weather] = await Promise.all([localizePlace(found, place, lang), currentWeather(found.latitude, found.longitude)]);
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

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
// The language Open-Meteo writes place names in, for each language of Petto.
const GEOCODING_LANGUAGES = { es: 'es', 'pt-BR': 'pt' };
const LOCALIZE_TIMEOUT_MS = 1500;
const LOCALIZE_RESULTS = 10;

const placeOf = (result) => ({
  id: result.id,
  name: result.name,
  country: result.country,
  countryCode: result.country_code,
  admin1: result.admin1,
  isCountry: /^PCL/.test(result.feature_code ?? ''),
  latitude: result.latitude,
  longitude: result.longitude,
});

/** The name of a country in `lang`, from its ISO code (Intl knows them all); null when it cannot tell. */
function countryName(code, lang) {
  if (!code) return null;
  try {
    return new Intl.DisplayNames([lang], { type: 'region' }).of(String(code).toUpperCase()) ?? null;
  } catch {
    return null;
  }
}

// The search stays in English: Open-Meteo's `language` also changes which place matches a name (with `es`, "Germany"
// finds a town in the United States). The names are then shown in the server's language by `localizePlace`.
async function geocode(name, fetchImpl = fetch) {
  const url = `${GEOCODING_URL}?name=${encodeURIComponent(name)}&count=1&language=en&format=json`;
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Geocoding failed with ${response.status}`); // i18n-ignore: internal error, execute answers with its own message
  const body = await response.json();
  const result = body.results?.[0];
  return result ? placeOf(result) : null;
}

/**
 * The place found in English, with its name, country and region written in `lang`: the same search again in that language,
 * keeping only the result with the same id. When that search does not find it (or is slow or fails), the country is named from
 * its code (and so is the place when it is a country itself) and the rest keeps the English names. English makes no second call.
 */
async function localizePlace(place, query, lang, fetchImpl = fetch) {
  const language = GEOCODING_LANGUAGES[lang];
  if (!language || !place) return place;
  const fromCode = () => {
    const country = countryName(place.countryCode, lang) || place.country;
    return { ...place, country, name: place.isCountry ? country : place.name };
  };
  try {
    const url = `${GEOCODING_URL}?name=${encodeURIComponent(query)}&count=${LOCALIZE_RESULTS}&language=${language}&format=json`;
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(LOCALIZE_TIMEOUT_MS) });
    if (!response.ok) return fromCode();
    const body = await response.json();
    const same = place.id == null ? null : (body.results ?? []).find((result) => result.id === place.id);
    if (!same) return fromCode();
    return { ...place, name: same.name || place.name, country: same.country || place.country, admin1: same.admin1 || place.admin1 };
  } catch {
    return fromCode();
  }
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
module.exports.localizePlace = localizePlace;
