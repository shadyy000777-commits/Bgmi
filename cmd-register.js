const {
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('register')
    .setDescription('Post the team registration panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('📥 Team Registration')
      .setColor(0x57F287)
      .setDescription(
        'Click the button below to register your team for the scrim.\n\n' +
        "Already verified through `/verify-panel`? You'll be able to reuse your saved team profile — " +
        'no need to retype everything.\n\n' +
        '_Admins: run `/scrim-open` first so registration is open._'
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('register_team_start')
        .setLabel('Register Team')
        .setEmoji('📥')
        .setStyle(ButtonStyle.Primary)
    );

    // channel.send instead of interaction.reply — no "used /register"
    // attribution line above a panel players will click for a long time.
    await interaction.channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ content: '✅ Panel posted.', flags: MessageFlags.Ephemeral });
  },
};
