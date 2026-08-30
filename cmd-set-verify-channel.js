const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-verify-channel')
    .setDescription('Choose the channel where verified team submissions get posted')
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('The channel to post verified submissions to')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');

    const store = getGuildStore(interaction.guildId);
    if (!store.settings) store.settings = {};
    store.settings.verifyLogChannelId = channel.id;
    saveGuildStore(interaction.guildId, store);

    await interaction.reply({
      content: `✅ Verified team submissions will now be posted to ${channel}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
