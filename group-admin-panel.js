const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');

// Same bar every other admin-only action in this codebase uses (schedule
// edits, punishing teams, etc.) — keeps "who can click these buttons"
// consistent across the whole bot.
function hasAdminAccess(interaction) {
  return interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
}

// The control buttons, attached directly onto that group's header message
// (the "Slots filled + match schedule" embed) rather than a separate
// standalone message — so they sit right under that embed instead of
// introducing their own box. Match Reminder / Publish Slot List / Punish
// Team / Result / Delete Group are admin-only (Manage Server) — anyone else
// tapping one gets an ephemeral "no permission" reply (see
// group-admin-handlers.js) and nothing in the channel changes. Change Slot
// is the one exception: it's meant for any player in the group to use on
// themselves, so it's routed separately (see group_change_slot: in
// index.js) instead of through handleGroupAdminButton's admin gate.
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

  const changeSlotRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`group_change_slot:${groupLetter}`)
      .setLabel('Change Slot')
      .setEmoji('🔄')
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
    new ButtonBuilder()
      .setCustomId(`group_admin_delete:${groupLetter}`)
      .setLabel('Delete Group')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger),
  );

  return [reminderRow, publishRow, changeSlotRow, actionRow];
}

module.exports = { hasAdminAccess, buildGroupAdminPanelRows };
