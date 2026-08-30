const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify-panel')
    .setDescription('Post the team verification panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('📝 Team Verification')
      .setColor(0xF5A623)
      .setDescription(
        'Click the button below to verify your BGMI team details.\n\n' +
        'You\'ll be asked for your **Team Name**, **Team Owner Full Name**, **WhatsApp Contact Number**, ' +
        '**Team Owner Email**, **City**, and each **Player\'s In-Game Name + Game UID** for Players 1-5 across 3 quick steps — ' +
        'then you\'ll select the **4 players who will play** (the 5th is marked as substitute).\n\n' +
        '⚠️ Every field is required, and you can only verify once — already verified? Use **Edit** to update your details. ' +
        'Your registered date is recorded automatically when you finish.\n\n' +
        '_Admins: run `/set-verify-channel` first so submissions have somewhere to post._'
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('verify_start')
        .setLabel('Verify')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('verify_edit_start')
        .setLabel('Edit')
        .setEmoji('✏️')
        .setStyle(ButtonStyle.Secondary)
    );

    // channel.send instead of interaction.reply — no "used /verify-panel"
    // attribution line above a panel players will click for a long time.
    await interaction.channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ content: '✅ Panel posted.', flags: MessageFlags.Ephemeral });
  },
};
