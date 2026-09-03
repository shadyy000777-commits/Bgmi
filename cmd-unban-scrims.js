const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');
const { SCRIMS_BAN_ROLE_NAME } = require('./punish-handlers');

// Manually lifts a Scrims Ban given via the "punish selected teams" flow
// (see punish-handlers.js) — removes the Scrims Ban role from the player
// and clears their tracked expiry, so they can register again immediately
// instead of waiting out the full 2-day window.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('unban-scrims')
    .setDescription("Lift a player's Scrims Ban so they can register again right away")
    .addUserOption(opt =>
      opt.setName('player').setDescription('The banned player to unban').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const target = interaction.options.getUser('player');
    const store = getGuildStore(interaction.guildId);

    const bans = store.settings && store.settings.scrimsBans;
    const wasTracked = !!(bans && bans[target.id]);
    const roleId = store.settings && store.settings.scrimsBanRoleId;

    let hadRole = false;
    let roleNote = '';

    try {
      const member = await interaction.guild.members.fetch(target.id);
      if (roleId && member.roles.cache.has(roleId)) {
        hadRole = true;
        await member.roles.remove(roleId, `Scrims Ban lifted by ${interaction.user.tag}`);
      }
    } catch (err) {
      // Member may have left the server, or the bot may lack permissions —
      // the tracking entry (checked below) still gets cleared either way.
      if (wasTracked) {
        roleNote = '\n⚠️ Could not update their roles (they may have left the server, or I lack permission).';
      }
    }

    if (!wasTracked && !hadRole) {
      return interaction.reply({
        content: `❌ ${target} isn't currently under a **${SCRIMS_BAN_ROLE_NAME}**.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (bans) delete bans[target.id];
    saveGuildStore(interaction.guildId, store);

    await interaction.reply({
      content: `✅ Lifted the **${SCRIMS_BAN_ROLE_NAME}** from ${target} — they can register again right away.${roleNote}`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
