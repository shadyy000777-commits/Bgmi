const { 
  SlashCommandBuilder, 
  PermissionFlagsBits, 
  ActionRowBuilder, 
  StringSelectMenuBuilder, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle 
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('scrim-wizard')
    .setDescription('Configure and launch a new scrim registration session')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    // Step 1: Select Total Slots
    const slotSelect = new StringSelectMenuBuilder()
      .setCustomId('wizard_select_slots')
      .setPlaceholder('Select total slots for this scrim')
      .addOptions([
        { label: '12 Slots (T1 Scrims)', value: '12' },
        { label: '18 Slots (Standard)', value: '18' },
        { label: '20 Slots (Full Lobby)', value: '20' },
        { label: '25 Slots (Extended)', value: '25' },
      ]);

    const row = new ActionRowBuilder().addComponents(slotSelect);

    await interaction.reply({
      content: '⚙️ **BGMI Scrims Setup Wizard**\nStep 1: Choose the total number of slots available for this lobby.',
      components: [row],
      ephemeral: true
    });
  }
};
