const { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder, MessageFlags } = require('discord.js');
const ExcelJS = require('exceljs');
const { getGuildStore } = require('./storage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('export-verifications')
    .setDescription('Export all verified team details to an Excel file')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const store = getGuildStore(interaction.guildId);
    const verifications = store.verifications || {};
    const entries = Object.entries(verifications);

    if (entries.length === 0) {
      return interaction.reply({
        content: '❌ No verified teams yet — nothing to export.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Verified Teams');

    sheet.columns = [
      { header: 'Team #', key: 'teamNumber', width: 10 },
      { header: 'Team Name', key: 'team_name', width: 22 },
      { header: 'Owner Full Name', key: 'owner_name', width: 22 },
      { header: 'City', key: 'city', width: 18 },
      { header: 'Owner Discord ID', key: 'ownerDiscord', width: 22 },
      { header: 'Owner Email', key: 'owner_email', width: 26 },
      { header: 'WhatsApp', key: 'whatsapp', width: 16 },
      { header: 'Player 1 IGN', key: 'p1_ign', width: 18 },
      { header: 'Player 1 UID', key: 'p1_uid', width: 16 },
      { header: 'Player 2 IGN', key: 'p2_ign', width: 18 },
      { header: 'Player 2 UID', key: 'p2_uid', width: 16 },
      { header: 'Player 3 IGN', key: 'p3_ign', width: 18 },
      { header: 'Player 3 UID', key: 'p3_uid', width: 16 },
      { header: 'Player 4 IGN', key: 'p4_ign', width: 18 },
      { header: 'Player 4 UID', key: 'p4_uid', width: 16 },
      { header: 'Player 5 IGN', key: 'p5_ign', width: 18 },
      { header: 'Player 5 UID', key: 'p5_uid', width: 16 },
      { header: 'Playing Lineup (Discord IDs)', key: 'lineup', width: 40 },
      { header: 'Registered Date', key: 'registeredDate', width: 22 },
    ];
    sheet.getRow(1).font = { bold: true };

    // The map key is already each owner's Discord user ID (snowflake) —
    // no need to fetch their profile at all.
    for (const [userId, data] of entries) {
      // Records saved before the lineup-select step was added won't have
      // selectedPlayerIds at all — leave the column blank rather than guessing.
      const lineup = (data.selectedPlayerIds || []).join(', ');

      const rowValues = {
        ...data,
        ownerDiscord: userId,
        lineup,
        registeredDate: data.registeredDate ? new Date(data.registeredDate).toUTCString() : '',
      };
      const newRow = sheet.addRow(rowValues);
      // Excel auto-converts long digit strings to scientific notation unless
      // the cell is explicitly formatted as text.
      newRow.getCell('ownerDiscord').numFmt = '@';
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const attachment = new AttachmentBuilder(Buffer.from(buffer), {
      name: `verified-teams-${interaction.guildId}.xlsx`,
    });

    await interaction.editReply({
      content: `✅ Exported **${entries.length}** verified team(s).`,
      files: [attachment],
    });
  },
};
