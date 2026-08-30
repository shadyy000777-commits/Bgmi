const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getGuildStore } = require('./storage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription("View a member's warning history")
    .addUserOption(opt => opt.setName('user').setDescription('Member to check').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const target = interaction.options.getUser('user');
    const store = getGuildStore(interaction.guildId);
    const list = store.warnings[target.id] || [];

    const embed = new EmbedBuilder()
      .setTitle(`⚠️ Warnings for ${target.tag}`)
      .setColor(0xFEE75C)
      .setDescription(list.length
        ? list.map((w, i) => `**${i + 1}.** ${w.reason} — <t:${Math.floor(new Date(w.timestamp).getTime() / 1000)}:R>`).join('\n')
        : '_No warnings on record._');

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
