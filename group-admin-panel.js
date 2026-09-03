const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');

// Same bar every other admin-only action in this codebase uses (schedule
// edits, punishing teams, etc.) — keeps "who can click these buttons"
// consistent across the whole bot.
function hasAdminAccess(interaction) {
  return interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
}

// The admin control buttons, attached directly onto that group's header
// message (the "Slots filled + match schedule" embed) rather than a
// separate standalone message — so they sit right under that embed instead
// of introducing their own box. Only admins (Manage Server) can actually
// use these; anyone else tapping one gets an ephemeral "no permission"
// reply (see group-admin-handlers.js) and nothing in the channel changes.
function buildGroupAdminPanelRows(groupLetter) {
  const reminderRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`group_admin_reminder:${groupLetter}`)
      .setLabel('Match Reminder')
      .setEmoji('⏰')
      .setStyle(ButtonStyle.Secondary),
  );

  const publishRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`group_admin_publish:${groupLetter}`)
      .setLabel('Publish Slot List')
      .setEmoji('📤')
      .setStyle(ButtonStyle.Success),
  );

  const manageRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`group_admin_manage:${groupLetter}`)
      .setLabel('Manage Matches')
      .setEmoji('🛠️')
      .setStyle(ButtonStyle.Secondary),
  );

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`group_admin_punish:${groupLetter}`)
      .setLabel('Punish Team')
      .setEmoji('🔨')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`group_admin_result:${groupLetter}`)
      .setLabel('Result')
      .setEmoji('🌟')
      .setStyle(ButtonStyle.Primary),
  );

  return [reminderRow, publishRow, manageRow, actionRow];
}

module.exports = { hasAdminAccess, buildGroupAdminPanelRows };
