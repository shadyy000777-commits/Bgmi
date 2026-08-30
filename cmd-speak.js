const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('speak')
    .setDescription('Send a message as the bot')
    .addStringOption(opt =>
      opt.setName('message')
        .setDescription('What the bot should say')
        .setRequired(true)
        .setMaxLength(2000))
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('Channel to post in (defaults to this channel)')
        .addChannelTypes(ChannelType.GuildText))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const message = interaction.options.getString('message');
    const channel = interaction.options.getChannel('channel') || interaction.channel;

    if (!channel.isTextBased()) {
      return interaction.reply({
        content: '❌ That channel isn\'t a text channel I can post in.',
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      await channel.send({ content: message });
    } catch (err) {
      console.error('Failed to send /speak message:', err);
      return interaction.reply({
        content: `❌ Couldn't send that — I might be missing permissions in ${channel}.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Ephemeral means only the person who ran this command sees this
    // confirmation — Discord doesn't show a "used /speak" line to anyone else
    // when the reply is ephemeral, so the posted message reads as just the bot speaking.
    await interaction.reply({
      content: `✅ Sent to ${channel}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
