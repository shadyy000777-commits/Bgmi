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

    // Strip the verified role too, same idea as /remove-registration — a
    // player without a saved verification shouldn't still be holding the
    // role that was only meant to reflect it.
    const roleId = store.settings && store.settings.verifiedRoleId;
    let roleNote = '';
    if (roleId) {
      try {
        const member = await interaction.guild.members.fetch(target.id);
        if (member.roles.cache.has(roleId)) await member.roles.remove(roleId);
      } catch (err) {
        // Member may have left the server, or the bot may lack permissions —
        // the verification is still removed either way.
        roleNote = ' ⚠️ Could not update their roles (they may have left the server, or I lack permission).';
      }
    }

    await interaction.reply({
      content: `✅ Removed the verification for team **${existing.team_name}** (${target}). They can now run \`/verify-panel\` again.${roleNote}`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
