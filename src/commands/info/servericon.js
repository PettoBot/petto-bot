// /servericon: Shows this server's icon, with links in every size. A command of its own (it was `/server icon`), registered in each server (the second set of slash commands). The picture is built by utils/serverImages.js.
const { SlashCommandBuilder } = require('discord.js');
const { serverImagePayload } = require('../../utils/serverImages');
const { languageOf } = require('../../i18n');

module.exports = {
  data: new SlashCommandBuilder().setName('servericon').setDMPermission(false).setDescription("Shows this server's icon, with links in every size."),
  async execute(interaction) {
    const lang = await languageOf(interaction);
    await interaction.reply(serverImagePayload(interaction.guild, 'icon', lang));
  },
};
