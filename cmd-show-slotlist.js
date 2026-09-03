const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getGuildStore } = require('./storage');
const { letterForIndex, activeGroupLetters, groupDisplayName } = require('./group-schedule');
const { buildGroupHeaderEmbed, buildGroupRosterEmbed } = require('./live-panel-handlers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('show-slotlist')
    .setDescription("Privately view a group's slot list — only you can see the reply")
    .addIntegerOption(opt =>
      opt.setName('group').setDescription('Group number, e.g. 1 for Group 1').setRequired(true).setMinValue(1))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const store = getGuildStore(interaction.guildId);
    const scrim = store.scrim;

    if (!scrim) {
      return interaction.reply({ content: '❌ No scrim is set up right now.', flags: MessageFlags.Ephemeral });
    }

    const groupNumber = interaction.options.getInteger('group');
    const letter = letterForIndex(groupNumber - 1);
    const totalGroups = activeGroupLetters(scrim.totalSlots).length;

    if (groupNumber > totalGroups) {
      return interaction.reply({
        content: `❌ ${groupDisplayName(letter)} doesn't exist yet — this scrim only has ${totalGroups} group(s) so far.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Reuses the exact same embeds the public group channel shows — this
    // is just a private, on-demand way to check them without needing to
    // hop into that group's channel (or before the roster's been
    // published there at all — see "Publish Slot List").
    await interaction.reply({
      embeds: [buildGroupHeaderEmbed(store, letter), buildGroupRosterEmbed(store, letter)],
      flags: MessageFlags.Ephemeral,
    });
  },
};
