const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { COLORS } = require('../../utils/colors');

// Country names resolve to a representative IANA zone. Users can still enter
// any exact IANA zone when they need a specific city or region.
const COUNTRY_ZONES = new Map(Object.entries({
  afghanistan: 'Asia/Kabul', afganistan: 'Asia/Kabul',
  albania: 'Europe/Tirane',
  algeria: 'Africa/Algiers', argelia: 'Africa/Algiers',
  andorra: 'Europe/Andorra',
  angola: 'Africa/Luanda',
  antigua_and_barbuda: 'America/Antigua', antigua_y_barbuda: 'America/Antigua',
  argentina: 'America/Argentina/Buenos_Aires',
  armenia: 'Asia/Yerevan',
  australia: 'Australia/Sydney',
  austria: 'Europe/Vienna',
  azerbaijan: 'Asia/Baku', azerbaiyan: 'Asia/Baku',
  bahamas: 'America/Nassau',
  bahrain: 'Asia/Bahrain', bahrein: 'Asia/Bahrain',
  bangladesh: 'Asia/Dhaka',
  barbados: 'America/Barbados',
  belarus: 'Europe/Minsk', bielorrusia: 'Europe/Minsk',
  belgium: 'Europe/Brussels', belgica: 'Europe/Brussels',
  belize: 'America/Belize', belice: 'America/Belize',
  benin: 'Africa/Porto-Novo',
  bhutan: 'Asia/Thimphu', butan: 'Asia/Thimphu',
  bolivia: 'America/La_Paz',
  bosnia_and_herzegovina: 'Europe/Sarajevo', bosnia_y_herzegovina: 'Europe/Sarajevo',
  botswana: 'Africa/Gaborone', botsuana: 'Africa/Gaborone',
  brazil: 'America/Sao_Paulo', brasil: 'America/Sao_Paulo',
  brunei: 'Asia/Brunei',
  bulgaria: 'Europe/Sofia',
  burkina_faso: 'Africa/Ouagadougou',
  burundi: 'Africa/Bujumbura',
  cabo_verde: 'Atlantic/Cape_Verde', cape_verde: 'Atlantic/Cape_Verde',
  cambodia: 'Asia/Phnom_Penh', camboya: 'Asia/Phnom_Penh',
  cameroon: 'Africa/Douala', camerun: 'Africa/Douala',
  canada: 'America/Toronto',
  central_african_republic: 'Africa/Bangui', republica_centroafricana: 'Africa/Bangui',
  chad: 'Africa/Ndjamena',
  chile: 'America/Santiago',
  china: 'Asia/Shanghai',
  colombia: 'America/Bogota',
  comoros: 'Indian/Comoro', comoras: 'Indian/Comoro',
  congo: 'Africa/Kinshasa',
  republic_of_the_congo: 'Africa/Brazzaville', republica_del_congo: 'Africa/Brazzaville',
  democratic_republic_of_the_congo: 'Africa/Kinshasa', republica_democratica_del_congo: 'Africa/Kinshasa', dr_congo: 'Africa/Kinshasa',
  costa_rica: 'America/Costa_Rica',
  croatia: 'Europe/Zagreb', croacia: 'Europe/Zagreb',
  cuba: 'America/Havana',
  cyprus: 'Asia/Nicosia', chipre: 'Asia/Nicosia',
  czechia: 'Europe/Prague', czech_republic: 'Europe/Prague', chequia: 'Europe/Prague', republica_checa: 'Europe/Prague',
  denmark: 'Europe/Copenhagen', dinamarca: 'Europe/Copenhagen',
  djibouti: 'Africa/Djibouti',
  dominica: 'America/Dominica',
  dominican_republic: 'America/Santo_Domingo', republica_dominicana: 'America/Santo_Domingo',
  ecuador: 'America/Guayaquil',
  egypt: 'Africa/Cairo', egipto: 'Africa/Cairo',
  el_salvador: 'America/El_Salvador', salvador: 'America/El_Salvador',
  equatorial_guinea: 'Africa/Malabo', guinea_ecuatorial: 'Africa/Malabo',
  eritrea: 'Africa/Asmara',
  estonia: 'Europe/Tallinn',
  eswatini: 'Africa/Mbabane', esuatini: 'Africa/Mbabane', swaziland: 'Africa/Mbabane',
  ethiopia: 'Africa/Addis_Ababa', etiopia: 'Africa/Addis_Ababa',
  fiji: 'Pacific/Fiji',
  finland: 'Europe/Helsinki', finlandia: 'Europe/Helsinki',
  france: 'Europe/Paris', francia: 'Europe/Paris',
  gabon: 'Africa/Libreville',
  gambia: 'Africa/Banjul',
  georgia: 'Asia/Tbilisi',
  germany: 'Europe/Berlin', alemania: 'Europe/Berlin',
  ghana: 'Africa/Accra',
  greece: 'Europe/Athens', grecia: 'Europe/Athens',
  grenada: 'America/Grenada', granada: 'America/Grenada',
  guatemala: 'America/Guatemala',
  guinea: 'Africa/Conakry',
  guinea_bissau: 'Africa/Bissau', guinea_bisau: 'Africa/Bissau',
  guyana: 'America/Guyana',
  haiti: 'America/Port-au-Prince',
  honduras: 'America/Tegucigalpa',
  hungary: 'Europe/Budapest', hungria: 'Europe/Budapest',
  iceland: 'Atlantic/Reykjavik', islandia: 'Atlantic/Reykjavik',
  india: 'Asia/Kolkata',
  indonesia: 'Asia/Jakarta',
  iran: 'Asia/Tehran',
  iraq: 'Asia/Baghdad',
  ireland: 'Europe/Dublin', irlanda: 'Europe/Dublin',
  israel: 'Asia/Jerusalem',
  italy: 'Europe/Rome', italia: 'Europe/Rome',
  ivory_coast: 'Africa/Abidjan', cote_divoire: 'Africa/Abidjan', cote_d_ivoire: 'Africa/Abidjan', costa_de_marfil: 'Africa/Abidjan',
  jamaica: 'America/Jamaica',
  japan: 'Asia/Tokyo', japon: 'Asia/Tokyo',
  jordan: 'Asia/Amman', jordania: 'Asia/Amman',
  kazakhstan: 'Asia/Almaty', kazajistan: 'Asia/Almaty',
  kenya: 'Africa/Nairobi', kenia: 'Africa/Nairobi',
  kiribati: 'Pacific/Tarawa',
  kosovo: 'Europe/Belgrade',
  kuwait: 'Asia/Kuwait',
  kyrgyzstan: 'Asia/Bishkek', kirguistan: 'Asia/Bishkek',
  laos: 'Asia/Vientiane',
  latvia: 'Europe/Riga', letonia: 'Europe/Riga',
  lebanon: 'Asia/Beirut', libano: 'Asia/Beirut',
  lesotho: 'Africa/Maseru',
  liberia: 'Africa/Monrovia',
  libya: 'Africa/Tripoli', libia: 'Africa/Tripoli',
  liechtenstein: 'Europe/Vaduz',
  lithuania: 'Europe/Vilnius', lituania: 'Europe/Vilnius',
  luxembourg: 'Europe/Luxembourg', luxemburgo: 'Europe/Luxembourg',
  madagascar: 'Indian/Antananarivo',
  malawi: 'Africa/Blantyre', malaui: 'Africa/Blantyre',
  malaysia: 'Asia/Kuala_Lumpur', malasia: 'Asia/Kuala_Lumpur',
  maldives: 'Indian/Maldives', maldivas: 'Indian/Maldives',
  mali: 'Africa/Bamako',
  malta: 'Europe/Malta',
  marshall_islands: 'Pacific/Majuro', islas_marshall: 'Pacific/Majuro',
  mauritania: 'Africa/Nouakchott',
  mauritius: 'Indian/Mauritius', mauricio: 'Indian/Mauritius',
  mexico: 'America/Mexico_City',
  micronesia: 'Pacific/Pohnpei', federated_states_of_micronesia: 'Pacific/Pohnpei', estados_federados_de_micronesia: 'Pacific/Pohnpei',
  moldova: 'Europe/Chisinau', moldavia: 'Europe/Chisinau',
  monaco: 'Europe/Monaco',
  mongolia: 'Asia/Ulaanbaatar',
  montenegro: 'Europe/Podgorica',
  morocco: 'Africa/Casablanca', marruecos: 'Africa/Casablanca',
  mozambique: 'Africa/Maputo',
  myanmar: 'Asia/Yangon', burma: 'Asia/Yangon', birmania: 'Asia/Yangon',
  namibia: 'Africa/Windhoek',
  nauru: 'Pacific/Nauru',
  nepal: 'Asia/Kathmandu',
  netherlands: 'Europe/Amsterdam', paises_bajos: 'Europe/Amsterdam', holland: 'Europe/Amsterdam', holanda: 'Europe/Amsterdam',
  new_zealand: 'Pacific/Auckland', nueva_zelanda: 'Pacific/Auckland',
  nicaragua: 'America/Managua',
  niger: 'Africa/Niamey',
  nigeria: 'Africa/Lagos',
  north_korea: 'Asia/Pyongyang', corea_del_norte: 'Asia/Pyongyang',
  north_macedonia: 'Europe/Skopje', macedonia_del_norte: 'Europe/Skopje',
  norway: 'Europe/Oslo', noruega: 'Europe/Oslo',
  oman: 'Asia/Muscat',
  pakistan: 'Asia/Karachi',
  palau: 'Pacific/Palau', palaos: 'Pacific/Palau',
  palestine: 'Asia/Gaza', palestina: 'Asia/Gaza', state_of_palestine: 'Asia/Gaza', estado_de_palestina: 'Asia/Gaza',
  panama: 'America/Panama',
  papua_new_guinea: 'Pacific/Port_Moresby', papua_nueva_guinea: 'Pacific/Port_Moresby',
  paraguay: 'America/Asuncion',
  peru: 'America/Lima',
  philippines: 'Asia/Manila', filipinas: 'Asia/Manila',
  poland: 'Europe/Warsaw', polonia: 'Europe/Warsaw',
  portugal: 'Europe/Lisbon',
  qatar: 'Asia/Qatar',
  romania: 'Europe/Bucharest', rumania: 'Europe/Bucharest',
  russia: 'Europe/Moscow', rusia: 'Europe/Moscow',
  rwanda: 'Africa/Kigali', ruanda: 'Africa/Kigali',
  saint_kitts_and_nevis: 'America/St_Kitts', san_cristobal_y_nieves: 'America/St_Kitts',
  saint_lucia: 'America/St_Lucia', santa_lucia: 'America/St_Lucia',
  saint_vincent_and_the_grenadines: 'America/St_Vincent', san_vicente_y_las_granadinas: 'America/St_Vincent',
  samoa: 'Pacific/Apia',
  san_marino: 'Europe/San_Marino',
  sao_tome_and_principe: 'Africa/Sao_Tome', santo_tome_y_principe: 'Africa/Sao_Tome',
  saudi_arabia: 'Asia/Riyadh', arabia_saudita: 'Asia/Riyadh',
  senegal: 'Africa/Dakar',
  serbia: 'Europe/Belgrade',
  seychelles: 'Indian/Mahe',
  sierra_leone: 'Africa/Freetown', sierra_leona: 'Africa/Freetown',
  singapore: 'Asia/Singapore', singapur: 'Asia/Singapore',
  slovakia: 'Europe/Bratislava', eslovaquia: 'Europe/Bratislava',
  slovenia: 'Europe/Ljubljana', eslovenia: 'Europe/Ljubljana',
  solomon_islands: 'Pacific/Guadalcanal', islas_salomon: 'Pacific/Guadalcanal',
  somalia: 'Africa/Mogadishu',
  south_africa: 'Africa/Johannesburg', sudafrica: 'Africa/Johannesburg',
  south_korea: 'Asia/Seoul', corea: 'Asia/Seoul', korea: 'Asia/Seoul', corea_del_sur: 'Asia/Seoul',
  south_sudan: 'Africa/Juba', sudan_del_sur: 'Africa/Juba',
  spain: 'Europe/Madrid', espana: 'Europe/Madrid',
  sri_lanka: 'Asia/Colombo',
  sudan: 'Africa/Khartoum',
  suriname: 'America/Paramaribo', surinam: 'America/Paramaribo',
  sweden: 'Europe/Stockholm', suecia: 'Europe/Stockholm',
  switzerland: 'Europe/Zurich', suiza: 'Europe/Zurich',
  syria: 'Asia/Damascus', siria: 'Asia/Damascus',
  taiwan: 'Asia/Taipei',
  tajikistan: 'Asia/Dushanbe', tayikistan: 'Asia/Dushanbe',
  tanzania: 'Africa/Dar_es_Salaam',
  thailand: 'Asia/Bangkok', tailandia: 'Asia/Bangkok',
  timor_leste: 'Asia/Dili', east_timor: 'Asia/Dili', timor_oriental: 'Asia/Dili',
  togo: 'Africa/Lome',
  tonga: 'Pacific/Tongatapu',
  trinidad_and_tobago: 'America/Port_of_Spain', trinidad_y_tobago: 'America/Port_of_Spain',
  tunisia: 'Africa/Tunis', tunez: 'Africa/Tunis',
  turkey: 'Europe/Istanbul', turkiye: 'Europe/Istanbul', turquia: 'Europe/Istanbul',
  turkmenistan: 'Asia/Ashgabat',
  tuvalu: 'Pacific/Funafuti',
  uganda: 'Africa/Kampala',
  ukraine: 'Europe/Kyiv', ucrania: 'Europe/Kyiv',
  united_arab_emirates: 'Asia/Dubai', uae: 'Asia/Dubai', emiratos_arabes_unidos: 'Asia/Dubai',
  united_kingdom: 'Europe/London', reino_unido: 'Europe/London', uk: 'Europe/London', britain: 'Europe/London', gran_bretana: 'Europe/London',
  united_states: 'America/New_York', estados_unidos: 'America/New_York', usa: 'America/New_York', us: 'America/New_York', america: 'America/New_York',
  uruguay: 'America/Montevideo',
  uzbekistan: 'Asia/Tashkent',
  vanuatu: 'Pacific/Efate',
  vatican_city: 'Europe/Rome', ciudad_del_vaticano: 'Europe/Rome', vaticano: 'Europe/Rome',
  venezuela: 'America/Caracas',
  vietnam: 'Asia/Ho_Chi_Minh',
  yemen: 'Asia/Aden',
  zambia: 'Africa/Lusaka',
  zimbabwe: 'Africa/Harare', zimbabue: 'Africa/Harare',
}));

function normalizeZoneInput(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_');
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
    .addStringOption((option) => option.setName('timezone').setDescription('Country name or IANA zone, for example Colombia or America/Bogota').setRequired(false)),

  async execute(interaction) {
    const requested = interaction.options.getString('timezone')?.trim() || 'UTC';
    const { zone, label } = resolveTimezone(requested);
    let value;
    try {
      value = formatTime(zone);
    } catch {
      await interaction.reply({ content: 'That country or time zone is not valid. Try `Colombia`, `Japan`, `South Africa`, or `America/Bogota`.' });
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

  COUNTRY_ZONES,
  resolveTimezone,
};
