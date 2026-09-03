const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits,
} = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');
const { groupDisplayName } = require('./group-schedule');

// Same bar every other admin-only action in this codebase uses (schedule
// edits, punishing teams, etc.) — keeps "who can click these buttons"
// consistent across the whole bot.
function hasAdminAccess(interaction) {
  return interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
}

// The standing admin control panel posted in every group's own channel,
// right below that group's header + slot roster messages. Only admins
// (Manage Server) can actually use these buttons — anyone else tapping one
// gets an ephemeral "no permission" reply (see group-admin-handlers.js) and
// nothing in the channel changes.
function buildGroupAdminPanelPayload(groupLetter) {
  const embed = new EmbedBuilder()
    .setTitle('🛡️ Admin Panel')
    .setColor(0x2B2D31)
    .setDescription(`Admin controls for **${groupDisplayName(groupLetter)}**. Only admins (Manage Server) can use these.`);

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

  return { embeds: [embed], components: [reminderRow, publishRow, manageRow, actionRow] };
}

// Posts the admin panel once per group channel and leaves it alone after
// that — the buttons themselves never change, so there's nothing to
// refresh. Re-posts a fresh one only if the stored message was deleted.
async function ensureGroupAdminPanel(client, guildId, groupLetter) {
  const store = getGuildStore(guildId);
  const channelId = store.settings && store.settings.groupChannels && store.settings.groupChannels[groupLetter];
  if (!channelId) return;

  if (!store.settings.groupAdminPanelMessageIds) store.settings.groupAdminPanelMessageIds = {};
  const messageId = store.settings.groupAdminPanelMessageIds[groupLetter];

  try {
    const channel = await client.channels.fetch(channelId);

    if (messageId) {
      try {
        await channel.messages.fetch(messageId);
        return; // still there — panel content never changes, nothing to do
      } catch (err) {
        // The stored message is gone — fall through and post a fresh one.
      }
    }

    const sent = await channel.send(buildGroupAdminPanelPayload(groupLetter));
    store.settings.groupAdminPanelMessageIds[groupLetter] = sent.id;
    saveGuildStore(guildId, store);
  } catch (err) {
    console.error(`Failed to post admin panel for Group ${groupLetter} in guild ${guildId}:`, err.message);
  }
}

module.exports = { hasAdminAccess, buildGroupAdminPanelPayload, ensureGroupAdminPanel };
