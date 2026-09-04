const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-private-verify-channel')
    .setDescription('Choose the private channel where the full detailed team verification card gets posted')
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('The private/staff-only channel to post the detailed card to')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');

    const store = getGuildStore(interaction.guildId);
    if (!store.settings) store.settings = {};
    store.settings.privateVerifyLogChannelId = channel.id;
    saveGuildStore(interaction.guildId, store);

    await interaction.reply({
      content: `✅ The full detailed verification card (WhatsApp, email, per-player IGN/UID) will now be posted to ${channel}. ` +
        `Make sure that channel is actually private — this bot doesn't lock its permissions down for you.\n\n` +
        `The public channel set via \`/set-verify-channel\` will keep getting the short summary card.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
