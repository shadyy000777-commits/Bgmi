const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('scrim-close')
    .setDescription('Close registration, remove the registered role from everyone, and reset for the next scrim')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const store = getGuildStore(interaction.guildId);
    const scrim = store.scrim;

    if (!scrim) {
      return interaction.reply({
        content: '❌ No scrim has been set up yet — run `/scrim-open` first.',
        flags: MessageFlags.Ephemeral,
      });
    }
    if (!scrim.open) {
      return interaction.reply({
        content: '❌ This scrim is already closed.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const roleId = store.settings && store.settings.registeredRoleId;
    const registeredEntries = Object.values(scrim.slots || {});

    let roleRemoved = 0;
    let roleFailed = 0;

    if (roleId) {
      for (const slot of registeredEntries) {
        try {
          const member = await interaction.guild.members.fetch(slot.userId);
          if (member.roles.cache.has(roleId)) {
            await member.roles.remove(roleId);
          }
          roleRemoved++;
        } catch (err) {
          // Member may have left the server, or the bot may be missing
          // permissions — don't let one failure stop the rest of the cleanup.
          console.error(`Failed to remove registered role from ${slot.userId}:`, err);
          roleFailed++;
        }
      }
    }

    const teamCount = registeredEntries.length;

    // Close registration and reset the slot list so the next scrim starts
    // fresh — otherwise the duplicate-registration check would still see
    // these old entries and block everyone from registering again.
    scrim.open = false;
    scrim.slots = {};
    saveGuildStore(interaction.guildId, store);

    const embed = new EmbedBuilder()
      .setTitle('🔒 Scrim Closed')
      .setColor(0xED4245)
      .setDescription(
        `**${scrim.scrimName}** is now closed.\n\n` +
        `📋 **Teams cleared** — ${teamCount}\n` +
        (roleId
          ? `🎭 **Role removed** — ${roleRemoved} succeeded${roleFailed ? `, ${roleFailed} failed (member left or missing permissions)` : ''}`
          : '🎭 **Role removed** — no registered role is configured (`/set-register-role` to enable this)')
      );

    await interaction.editReply({ embeds: [embed] });
  },
};
