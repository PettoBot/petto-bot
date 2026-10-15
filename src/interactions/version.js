const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} = require('discord.js');
const { EMOJI } = require('../utils/emojis');
const { RELEASES, getLatestRelease, getRelease, getReleaseIndex } = require('../utils/releases');
const { t, currentLanguage, languageOf } = require('../i18n');

// The release notes themselves (names, status, summaries, sections) stay in English on purpose: they are the team's
// announcements. Only the card around them (position, menu, buttons) is translated.

const VERSION_SELECT_ID = 'version:select';
const PETTO_IMAGE_URL = 'https://i.imgur.com/WUwcYwM.png';

function versionActionId(action, version) {
  return `version:${action}:${version}`;
}

function buildReleaseCard(release, lang) {
  const position = getReleaseIndex(release.version) + 1;

  const header = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        `# ${EMOJI.RELEASE_ROCKET} Petto ${release.display ?? release.version}${release.name ? ` “${release.name}”` : ''}`,
        `${release.status}  ·  ${EMOJI.RELEASE_NOTE} ${release.date}`,
        t(lang, 'info.version.position', { position, total: RELEASES.length }),
      ].join('\n')),
    )
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(PETTO_IMAGE_URL));

  const card = new ContainerBuilder()
    .setAccentColor(release.accent)
    .addSectionComponents(header)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`> ${release.summary}`))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large));

  release.sections.forEach((section, index) => {
    if (index > 0) card.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
    card.addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        `### ${section.title}`,
        ...section.items.map((item) => `- ${item}`),
      ].join('\n')),
    );
  });

  card
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addActionRowComponents(buildVersionSelect(release.version, lang))
    .addActionRowComponents(buildNavigationRow(release.version, lang))
    .addActionRowComponents(buildLinksRow(lang));

  return card;
}

function buildVersionSelect(selectedVersion, lang) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(VERSION_SELECT_ID)
    .setPlaceholder(t(lang, 'info.version.choose.menu'))
    .addOptions(RELEASES.map((release) => {
      const option = new StringSelectMenuOptionBuilder()
        .setLabel(release.label)
        .setValue(release.version)
        .setDescription(release.summary.slice(0, 100))
        .setEmoji(release.version === selectedVersion ? EMOJI.RELEASE_APPROVED : EMOJI.RELEASE_NOTE);
      if (release.version === selectedVersion) option.setDefault(true);
      return option;
    }));

  return new ActionRowBuilder().addComponents(menu);
}

function buildNavigationRow(selectedVersion, lang) {
  const index = getReleaseIndex(selectedVersion);
  const isLatest = index === 0;
  const isOldest = index === RELEASES.length - 1;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(versionActionId('latest', selectedVersion))
      .setLabel(t(lang, 'info.version.latest.button'))
      .setEmoji(EMOJI.RELEASE_ROCKET)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(isLatest),
    new ButtonBuilder()
      .setCustomId(versionActionId('previous', selectedVersion))
      .setLabel(t(lang, 'info.version.previous.button'))
      .setEmoji(EMOJI.PREV)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isOldest),
    new ButtonBuilder()
      .setCustomId(versionActionId('next', selectedVersion))
      .setLabel(t(lang, 'info.version.next.button'))
      .setEmoji(EMOJI.NEXT)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isLatest),
    new ButtonBuilder()
      .setCustomId(versionActionId('refresh', selectedVersion))
      .setLabel(t(lang, 'info.version.refresh.button'))
      .setEmoji(EMOJI.RELEASE_RELOAD)
      .setStyle(ButtonStyle.Secondary),
  );
}

function buildLinksRow(lang) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel(t(lang, 'info.button.changelog.button')).setEmoji(EMOJI.RELEASE_CHANGELOG).setStyle(ButtonStyle.Link).setURL('https://petto.sbs/changelog/'),
    new ButtonBuilder().setLabel(t(lang, 'info.button.repository.button')).setEmoji(EMOJI.RELEASE_LINK).setStyle(ButtonStyle.Link).setURL('https://github.com/PettoBot/petto-bot'),
    new ButtonBuilder().setLabel(t(lang, 'info.button.dashboard.button')).setEmoji(EMOJI.RELEASE_PC).setStyle(ButtonStyle.Link).setURL('https://petto.sbs/dash'),
  );
}

function buildVersionPayload(version = getLatestRelease().version, lang = currentLanguage()) {
  const release = getRelease(version) ?? getLatestRelease();
  return { components: [buildReleaseCard(release, lang)], flags: MessageFlags.IsComponentsV2 };
}

function selectedVersionFromButton(customId) {
  return customId.split(':').slice(2).join(':');
}

async function handleSelect(interaction) {
  const version = interaction.values?.[0];
  if (!getRelease(version)) {
    await interaction.deferUpdate();
    return;
  }
  await interaction.update(buildVersionPayload(version, await languageOf(interaction)));
}

async function handleButton(interaction) {
  const [, action, currentVersion] = interaction.customId.split(':');
  const currentIndex = getReleaseIndex(currentVersion);
  let targetVersion = getRelease(currentVersion)?.version ?? getLatestRelease().version;

  if (action === 'latest') targetVersion = getLatestRelease().version;
  if (action === 'previous') targetVersion = RELEASES[Math.min(RELEASES.length - 1, currentIndex + 1)].version;
  if (action === 'next') targetVersion = RELEASES[Math.max(0, currentIndex - 1)].version;
  if (action === 'refresh') targetVersion = selectedVersionFromButton(interaction.customId);

  await interaction.update(buildVersionPayload(targetVersion, await languageOf(interaction)));
}

module.exports = { VERSION_SELECT_ID, handleSelect, handleButton, buildVersionPayload };
