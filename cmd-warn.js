const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Log a warning against a member')
    .addUserOption(opt => opt.setName('user').setDescription('Member to warn').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason for the warning').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');

    const store = getGuildStore(interaction.guildId);
    if (!store.warnings[target.id]) store.warnings[target.id] = [];
    store.warnings[target.id].push({
      reason, moderatorId: interaction.user.id, timestamp: new Date().toISOString(),
    });
    saveGuildStore(interaction.guildId, store);

    const count = store.warnings[target.id].length;

    // channel.send instead of interaction.reply — no "used /warn"
    // attribution line on the announcement.
    await interaction.channel.send(`⚠️ Warned **${target.tag}** — ${reason} (total warnings: **${count}**)`);
    await interaction.reply({ content: '✅ Done.', flags: MessageFlags.Ephemeral });
  },
};
