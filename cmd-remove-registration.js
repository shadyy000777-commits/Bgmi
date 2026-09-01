const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');
const { groupDisplayName } = require('./group-schedule');
const { refreshLivePanel } = require('./live-panel-handlers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remove-registration')
    .setDescription("Delete a player's team registration and free up their slot")
    .addUserOption(opt =>
      opt.setName('player').setDescription('The team owner whose registration to remove').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const store = getGuildStore(interaction.guildId);
    const scrim = store.scrim;

    if (!scrim) {
      return interaction.reply({ content: '❌ No scrim is set up right now.', flags: MessageFlags.Ephemeral });
    }

    const target = interaction.options.getUser('player');
    const slotEntry = Object.entries(scrim.slots).find(([, s]) => s.userId === target.id);

    if (!slotEntry) {
      return interaction.reply({ content: `❌ ${target} doesn't have an active registration in **${scrim.scrimName}**.`, flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const [slotNumStr, slot] = slotEntry;
    const slotNum = parseInt(slotNumStr, 10);

    // Strip the registered/group roles too, same as /scrim-close does —
    // otherwise the player keeps a role that no longer matches reality.
    const roleId = store.settings && store.settings.registeredRoleId;
    const groupRoles = (store.settings && store.settings.groupRoles) || {};
    const groupRoleId = groupRoles[slot.group];
    let roleNote = '';

    try {
      const member = await interaction.guild.members.fetch(target.id);
      if (roleId && member.roles.cache.has(roleId)) await member.roles.remove(roleId);
      if (groupRoleId && member.roles.cache.has(groupRoleId)) await member.roles.remove(groupRoleId);
    } catch (err) {
      // Member may have left the server, or the bot may lack permissions —
      // the registration is still removed either way.
      roleNote = '\n⚠️ Could not update their roles (they may have left the server, or I lack permission).';
    }

    delete scrim.slots[slotNum];
    saveGuildStore(interaction.guildId, store);
    await refreshLivePanel(interaction.client, interaction.guildId);

    const embed = new EmbedBuilder()
      .setTitle('🗑️ Registration Removed')
      .setColor(0xED4245)
      .addFields(
        { name: 'Player', value: `${target}`, inline: true },
        { name: 'Team', value: slot.team, inline: true },
        { name: 'Group', value: groupDisplayName(slot.group), inline: true },
      );

    await interaction.editReply({ content: roleNote || undefined, embeds: [embed] });
  },
};
