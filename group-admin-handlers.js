const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
} = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');
const {
  groupDisplayName, slotRangeForGroup, localSlotNumber, FIRST_ASSIGNABLE_SLOT, resolveGroupSchedule,
} = require('./group-schedule');
const { publishGroupRoster } = require('./live-panel-handlers');
const { buildGroupSchedulePanelPayload } = require('./group-schedule-handlers');
const { buildPunishSelectPayload } = require('./punish-handlers');
const { hasAdminAccess } = require('./group-admin-panel');
const { setGroupChannelOpen } = require('./group-channel-access');

function denyReply(interaction) {
  return interaction.reply({
    content: '❌ You need the **Manage Server** permission to use this.',
    flags: MessageFlags.Ephemeral,
  });
}

// Routes every `group_admin_<action>:<letter>` button from the admin panel
// posted in each group's channel (see group-admin-panel.js).
async function handleGroupAdminButton(interaction) {
  const [rawAction, groupLetter] = interaction.customId.split(':');
  if (!hasAdminAccess(interaction)) return denyReply(interaction);

  const store = getGuildStore(interaction.guildId);
  if (!store.scrim) {
    return interaction.reply({ content: '❌ No scrim is set up right now.', flags: MessageFlags.Ephemeral });
  }

  switch (rawAction) {
    case 'group_admin_reminder':
      return sendMatchReminder(interaction, store, groupLetter);
    case 'group_admin_publish': {
      const result = await publishGroupRoster(interaction.client, interaction.guildId, groupLetter);
      if (result.error) return interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral });
      return interaction.reply({
        content: `✅ Slot list published for **${groupDisplayName(groupLetter)}** — it'll now stay live-updated as teams register.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    case 'group_admin_manage':
      return interaction.reply({ ...buildGroupSchedulePanelPayload(store), flags: MessageFlags.Ephemeral });
    case 'group_admin_punish': {
      const payload = buildPunishSelectPayload(store.scrim, groupLetter);
      if (payload.error) return interaction.reply({ content: payload.error, flags: MessageFlags.Ephemeral });
      return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    }
    case 'group_admin_result':
      return interaction.showModal(buildResultModal(groupLetter));
    case 'group_admin_delete': {
      const channelId = store.settings.groupChannels && store.settings.groupChannels[groupLetter];
      const roleId = store.settings.groupRoles && store.settings.groupRoles[groupLetter];
      if (!channelId && !roleId) {
        return interaction.reply({ content: `❌ ${groupDisplayName(groupLetter)} doesn't have a channel or role to delete.`, flags: MessageFlags.Ephemeral });
      }
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`group_admin_delete_confirm:${groupLetter}`).setLabel('Yes, delete it').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`group_admin_delete_cancel:${groupLetter}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );
      return interaction.reply({
        content: `⚠️ Delete **${groupDisplayName(groupLetter)}**'s channel and role? This can't be undone — registered teams stay on record, but this channel/role won't come back on its own.`,
        components: [row],
        flags: MessageFlags.Ephemeral,
      });
    }
    case 'group_admin_delete_confirm':
      return handleDeleteGroupConfirm(interaction, store, groupLetter);
    case 'group_admin_delete_cancel':
      return interaction.update({ content: '❌ Cancelled — nothing was deleted.', components: [] });
    default:
      return;
  }
}

// Deletes the group's channel and role (whichever exist) and cleans up
// every stored reference to them — the standing header/roster message
// ids, the "published" flag, and the auto-created-role/channel tracking
// lists — so nothing points at a now-deleted channel or role afterward.
// Doesn't touch scrim.slots — registered teams stay on record even after
// their channel/role are cleaned up.
async function handleDeleteGroupConfirm(interaction, store, groupLetter) {
  await interaction.deferUpdate();

  const channelId = store.settings.groupChannels && store.settings.groupChannels[groupLetter];
  const roleId = store.settings.groupRoles && store.settings.groupRoles[groupLetter];
  const deleted = [];
  const failed = [];

  if (channelId) {
    try {
      const channel = interaction.guild.channels.cache.get(channelId);
      if (channel) await channel.delete(`Group deleted via Delete Group button (${groupDisplayName(groupLetter)})`);
      deleted.push('channel');
    } catch (err) {
      failed.push(`channel (${err.code ?? err.message})`);
    }
  }

  if (roleId) {
    try {
      const role = interaction.guild.roles.cache.get(roleId);
      if (role) await role.delete(`Group deleted via Delete Group button (${groupDisplayName(groupLetter)})`);
      deleted.push('role');
    } catch (err) {
      failed.push(`role (${err.code ?? err.message})`);
    }
  }

  if (!store.settings.groupChannels) store.settings.groupChannels = {};
  if (!store.settings.groupRoles) store.settings.groupRoles = {};
  delete store.settings.groupChannels[groupLetter];
  delete store.settings.groupRoles[groupLetter];
  if (store.settings.groupSlotListMessageIds) delete store.settings.groupSlotListMessageIds[groupLetter];
  if (store.settings.groupRosterMessageIds) delete store.settings.groupRosterMessageIds[groupLetter];
  if (store.settings.groupRosterPublished) delete store.settings.groupRosterPublished[groupLetter];
  if (store.settings.autoGroupChannelIds) store.settings.autoGroupChannelIds = store.settings.autoGroupChannelIds.filter(id => id !== channelId);
  if (store.settings.autoGroupRoleIds) store.settings.autoGroupRoleIds = store.settings.autoGroupRoleIds.filter(id => id !== roleId);
  saveGuildStore(interaction.guildId, store);

  const summary = deleted.length
    ? `🗑️ Deleted ${groupDisplayName(groupLetter)}'s ${deleted.join(' and ')}.`
    : `❌ Nothing was deleted.`;
  const failureNote = failed.length ? `\n⚠️ Couldn't delete: ${failed.join(', ')}.` : '';

  // The channel this message lived in may itself have just been deleted,
  // so editing the original reply can fail — that's fine, ignore it.
  await interaction.editReply({ content: summary + failureNote, components: [] }).catch(() => {});
}


// Posted publicly in-channel so players actually see it — not ephemeral.
async function sendMatchReminder(interaction, store, groupLetter) {
  const roleId = store.settings && store.settings.groupRoles && store.settings.groupRoles[groupLetter];
  const resolved = resolveGroupSchedule(groupLetter, store);

  const scheduleText = resolved
    ? resolved.matchesToShow
        .map((m, i) => `⏰ **Match ${i + 1}** — IDP ${m.idp} PM | Start ${m.start} PM | ${m.map}`)
        .join('\n')
    : 'Match schedule not set yet — ask an admin.';

  const mention = roleId ? `<@&${roleId}>` : `@everyone`;

  await interaction.reply({
    content: `📢 ${mention} **Match Reminder** — get ready!\n${scheduleText}\n\nBe online and ready **5 minutes before IDP**. Good luck! 🏆`,
    allowedMentions: roleId ? { roles: [roleId] } : { parse: ['everyone'] },
  });
}

function buildResultModal(groupLetter) {
  return new ModalBuilder()
    .setCustomId(`group_admin_result_modal:${groupLetter}`)
    .setTitle(`${groupDisplayName(groupLetter)} — Result`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('slot1')
          .setLabel('1st Place — Slot Number')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. 6')
          .setRequired(true)
          .setMaxLength(3),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('slot2')
          .setLabel('2nd Place — Slot Number')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. 11')
          .setRequired(true)
          .setMaxLength(3),
      ),
    );
}

// Looks up the team registered in a group-local slot number (the numbers
// players actually see, e.g. "Slot 6") and resolves it back to the
// underlying global slot key used everywhere else in storage.
function resolveLocalSlot(scrim, groupLetter, localNum) {
  const { start, end } = slotRangeForGroup(groupLetter, scrim.totalSlots);
  if (Number.isNaN(localNum)) return { error: `"${localNum}" isn't a number.` };

  const globalSlot = start + (localNum - FIRST_ASSIGNABLE_SLOT);
  if (globalSlot < start || globalSlot > end) {
    return { error: `Slot ${localNum} is out of range for this group (${localSlotNumber(start)}-${localSlotNumber(end)}).` };
  }

  const slot = scrim.slots[globalSlot];
  if (!slot) return { error: `Slot ${localNum} is empty.` };

  return { team: slot.team, userId: slot.userId };
}

// On submit: reads the two slot numbers, looks up each team's owner, and
// gives the configured result role (see cmd-set-result-role.js) to both.
async function handleGroupAdminResultModalSubmit(interaction) {
  const [, groupLetter] = interaction.customId.split(':');
  if (!hasAdminAccess(interaction)) return denyReply(interaction);

  const store = getGuildStore(interaction.guildId);
  const scrim = store.scrim;
  if (!scrim) {
    return interaction.reply({ content: '❌ No scrim is set up right now.', flags: MessageFlags.Ephemeral });
  }

  const roleId = store.settings && store.settings.resultRoleId;
  if (!roleId) {
    return interaction.reply({
      content: '❌ No result role configured yet — an admin needs to run `/set-result-role` first.',
      flags: MessageFlags.Ephemeral,
    });
  }
  const role = interaction.guild.roles.cache.get(roleId);
  if (!role) {
    return interaction.reply({
      content: '❌ The configured result role no longer exists — re-run `/set-result-role`.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const entries = [
    { label: '🥇 1st', localNum: parseInt(interaction.fields.getTextInputValue('slot1').trim(), 10) },
    { label: '🥈 2nd', localNum: parseInt(interaction.fields.getTextInputValue('slot2').trim(), 10) },
  ].map(e => ({ ...e, ...resolveLocalSlot(scrim, groupLetter, e.localNum) }));

  await interaction.deferReply();

  const lines = [];
  for (const entry of entries) {
    if (entry.error) {
      lines.push(`❌ ${entry.label} — ${entry.error}`);
      continue;
    }
    try {
      const member = await interaction.guild.members.fetch(entry.userId);
      await member.roles.add(roleId);
      lines.push(`✅ ${entry.label} — **${entry.team}** — gave ${role} to <@${entry.userId}>`);
    } catch (err) {
      lines.push(`⚠️ ${entry.label} — **${entry.team}** — couldn't give the role to <@${entry.userId}> (${err.code ?? err.message}).`);
    }
  }

  // Result is in — close the group's chat back down so only admins can
  // post there until the next time it's opened (see pcmd-open.js).
  const channelId = store.settings.groupChannels && store.settings.groupChannels[groupLetter];
  const groupRoleId = store.settings.groupRoles && store.settings.groupRoles[groupLetter];
  const channel = channelId ? interaction.guild.channels.cache.get(channelId) : null;

  if (channel && groupRoleId) {
    try {
      await setGroupChannelOpen(channel, groupRoleId, false, `Closed automatically after ${groupDisplayName(groupLetter)} result was submitted`);
      lines.push(`🔒 ${groupDisplayName(groupLetter)}'s channel is now closed to players.`);
    } catch (err) {
      console.error(`[group-admin-result] Failed to close ${groupDisplayName(groupLetter)}'s channel in guild ${interaction.guildId}: ${err.code ?? ''} ${err.message}`);
      lines.push(`⚠️ Couldn't close ${groupDisplayName(groupLetter)}'s channel automatically — check my **Manage Roles** permission.`);
    }
  }

  await interaction.editReply({ content: `🌟 **Result — ${groupDisplayName(groupLetter)}**\n${lines.join('\n')}` });
}

module.exports = { handleGroupAdminButton, handleGroupAdminResultModalSubmit };
