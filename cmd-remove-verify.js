const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');
const { clearPending } = require('./pending-verifications');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remove-verify')
    .setDescription("Remove a player's team verification so they can verify again")
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('The player whose verification should be removed')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const target = interaction.options.getUser('user');

    const store = getGuildStore(interaction.guildId);
    const existing = store.verifications && store.verifications[target.id];

    if (!existing) {
      return interaction.reply({
        content: `❌ ${target} doesn't have a saved verification.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    delete store.verifications[target.id];
    saveGuildStore(interaction.guildId, store);

    // In case they're mid-way through the 3-step form right now, clear that too
    // so a stale in-progress session can't finish and re-save after removal.
    clearPending(target.id);

    await interaction.reply({
      content: `✅ Removed the verification for team **${existing.team_name}** (${target}). They can now run \`/verify-panel\` again.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
