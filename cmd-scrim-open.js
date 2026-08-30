const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('scrim-open')
    .setDescription('Open registration for a new BGMI scrim')
    .addIntegerOption(opt =>
      opt.setName('slots').setDescription('Total number of slots').setRequired(true).setMinValue(1).setMaxValue(100))
    .addStringOption(opt =>
      opt.setName('name').setDescription('Scrim name/label (e.g. "Scrim 1 - Round 2")').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const totalSlots = interaction.options.getInteger('slots');
    const scrimName = interaction.options.getString('name') || 'BGMI Scrim';

    const store = getGuildStore(interaction.guildId);
    store.scrim = { open: true, scrimName, totalSlots, slots: {} };
    saveGuildStore(interaction.guildId, store);

    // channel.send instead of interaction.reply — no "used /scrim-open"
    // attribution line on the announcement.
    await interaction.channel.send(
      `✅ Registration opened for **${scrimName}** with **${totalSlots}** slots. Teams can now use \`/register\`.`
    );
    await interaction.reply({ content: '✅ Done.', flags: MessageFlags.Ephemeral });
  },
};
