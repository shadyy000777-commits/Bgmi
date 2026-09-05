const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('disable-ai-channel')
    .setDescription('Turn off the AI helper\'s auto-reply channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const store = getGuildStore(interaction.guildId);
    if (!store.settings) store.settings = {};

    if (!store.settings.aiChannelId) {
      return interaction.reply({
        content: 'ℹ️ The AI helper channel isn\'t set up right now — nothing to disable. (@mentioning the bot will still work anywhere.)',
        flags: MessageFlags.Ephemeral,
      });
    }

    store.settings.aiChannelId = null;
    saveGuildStore(interaction.guildId, store);

    await interaction.reply({
      content: '✅ Disabled the AI helper\'s auto-reply channel. Members can still @mention the bot anywhere to chat with it.',
      flags: MessageFlags.Ephemeral,
    });
  },
};
