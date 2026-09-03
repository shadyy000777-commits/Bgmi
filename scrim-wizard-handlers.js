const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, PermissionFlagsBits,
} = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');
const { buildSlotListEmbed } = require('./embeds');
const { refreshLivePanel } = require('./live-panel-handlers');
const { todayDayNumber } = require('./group-schedule');

// Builds the { embeds, components } payload for the !scrims wizard panel.
// Reused for the initial message.channel.send AND every interaction.update
// afterward, so the panel always reflects current state in place.
function buildScrimWizardPayload(store) {
  const scrim = store.scrim;

  if (!scrim) {
    const embed = new EmbedBuilder()
      .setTitle('⚔️ Scrim Setup')
      .setColor(0x5865F2)
      .setDescription('No scrim is set up yet. Click **Create Scrim** to get started.');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('scrim_wizard_create').setLabel('Create Scrim').setEmoji('➕').setStyle(ButtonStyle.Success)
    );

    return { embeds: [embed], components: [row] };
  }

  const filled = Object.keys(scrim.slots || {}).length;
  const embed = new EmbedBuilder()
    .setTitle(`⚔️ Scrim Setup — ${scrim.scrimName}`)
    .setColor(0x57F287)
    .addFields(
      { name: 'Status', value: '🟢 Open 24/7', inline: true },
      { name: 'Slots Filled', value: `${filled}/${scrim.totalSlots}`, inline: true },
    );

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('scrim_wizard_edit').setLabel('Edit').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('scrim_wizard_slotlist').setLabel('View Slot List').setEmoji('📋').setStyle(ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('scrim_wizard_delete').setLabel('Delete Scrim').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row1, row2] };
}

function buildScrimCreateModal() {
  return new ModalBuilder()
    .setCustomId('scrim_wizard_create_modal')
    .setTitle('Create Scrim')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('name').setLabel('Scrim name').setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. Scrim 1 - Round 2').setRequired(true).setMaxLength(80)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('slots').setLabel('Total slots').setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. 5000').setRequired(true).setMaxLength(5)
      ),
    );
}

function buildScrimEditModal(scrim) {
  return new ModalBuilder()
    .setCustomId('scrim_wizard_edit_modal')
    .setTitle('Edit Scrim')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('name').setLabel('Scrim name').setStyle(TextInputStyle.Short)
          .setValue(scrim.scrimName).setRequired(true).setMaxLength(80)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('slots').setLabel('Total slots').setStyle(TextInputStyle.Short)
          .setValue(String(scrim.totalSlots)).setRequired(true).setMaxLength(5)
      ),
    );
}

// Prev/Next row for the (possibly multi-page) Slot List embed. Returns []
// when there's only one page, so single-page scrims show no buttons at all.
function buildSlotListNavRow(page, totalPages) {
  if (totalPages <= 1) return [];
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`scrim_wizard_slotlist_page_${page - 1}`)
      .setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`scrim_wizard_slotlist_page_${page + 1}`)
      .setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1),
  )];
}

function hasManageGuild(interaction) {
  return interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
}

async function handleScrimWizardButton(interaction) {
  if (!hasManageGuild(interaction)) {
    return interaction.reply({ content: '❌ You need the **Manage Server** permission to do that.', flags: MessageFlags.Ephemeral });
  }

  const store = getGuildStore(interaction.guildId);
  const id = interaction.customId;

  if (id === 'scrim_wizard_create') {
    if (store.scrim) {
      return interaction.reply({ content: '❌ A scrim already exists. Delete it first to create a new one.', flags: MessageFlags.Ephemeral });
    }
    return interaction.showModal(buildScrimCreateModal());
  }

  if (id === 'scrim_wizard_edit') {
    if (!store.scrim) {
      return interaction.reply({ content: '❌ No scrim exists yet.', flags: MessageFlags.Ephemeral });
    }
    return interaction.showModal(buildScrimEditModal(store.scrim));
  }

  if (id === 'scrim_wizard_slotlist') {
    if (!store.scrim) {
      return interaction.reply({ content: '❌ No scrim exists yet.', flags: MessageFlags.Ephemeral });
    }
    const { embed, page, totalPages } = buildSlotListEmbed(store.scrim, 0);
    return interaction.reply({
      embeds: [embed],
      components: buildSlotListNavRow(page, totalPages),
      flags: MessageFlags.Ephemeral,
    });
  }

  if (id.startsWith('scrim_wizard_slotlist_page_')) {
    if (!store.scrim) {
      return interaction.update({ content: '❌ No scrim exists yet.', embeds: [], components: [] });
    }
    const requestedPage = parseInt(id.replace('scrim_wizard_slotlist_page_', ''), 10) || 0;
    const { embed, page, totalPages } = buildSlotListEmbed(store.scrim, requestedPage);
    return interaction.update({ embeds: [embed], components: buildSlotListNavRow(page, totalPages) });
  }

  if (id === 'scrim_wizard_delete') {
    if (!store.scrim) {
      return interaction.reply({ content: '❌ No scrim exists yet.', flags: MessageFlags.Ephemeral });
    }
    // Swap the panel itself into a confirm state (rather than a separate
    // reply) so the whole flow stays as edits to one message.
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('scrim_wizard_delete_confirm').setLabel('Yes, delete it').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('scrim_wizard_delete_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );
    return interaction.update({
      content: `⚠️ Delete **${store.scrim.scrimName}** and clear all registrations? This can't be undone.`,
      embeds: [],
      components: [row],
    });
  }

  if (id === 'scrim_wizard_delete_confirm') {
    // Deleting is the point of no return — strip registered/group roles
    // from everyone still holding them, then wipe the scrim data.
    const roleId = store.settings && store.settings.registeredRoleId;
    const groupRoles = (store.settings && store.settings.groupRoles) || {};
    const registeredEntries = Object.values(store.scrim.slots || {});

    for (const slot of registeredEntries) {
      try {
        const member = await interaction.guild.members.fetch(slot.userId);
        if (roleId && member.roles.cache.has(roleId)) await member.roles.remove(roleId);
        const groupRoleId = groupRoles[slot.group];
        if (groupRoleId && member.roles.cache.has(groupRoleId)) await member.roles.remove(groupRoleId);
      } catch (err) {
        console.error(`Failed to remove registered/group role from ${slot.userId}:`, err);
      }
    }

    // Delete the roles that were auto-created for this scrim's groups too
    // (roles admins set up manually via /set-group-role are left alone —
    // those are meant to be reused across scrims).
    const autoGroupRoleIds = (store.settings && store.settings.autoGroupRoleIds) || [];
    for (const roleId of autoGroupRoleIds) {
      try {
        const role = interaction.guild.roles.cache.get(roleId);
        if (role) await role.delete('Scrim deleted — auto-created group role no longer needed');
      } catch (err) {
        console.error(`Failed to delete auto-created group role ${roleId}:`, err);
      }
    }
    if (store.settings) {
      for (const roleId of autoGroupRoleIds) {
        const letter = Object.keys(store.settings.groupRoles || {}).find(l => store.settings.groupRoles[l] === roleId);
        if (letter) delete store.settings.groupRoles[letter];
      }
      store.settings.autoGroupRoleIds = [];
    }

    // Same cleanup for the auto-created group channels, plus the shared
    // category once it has no channels left in it.
    const autoGroupChannelIds = (store.settings && store.settings.autoGroupChannelIds) || [];
    for (const channelId of autoGroupChannelIds) {
      try {
        const channel = interaction.guild.channels.cache.get(channelId);
        if (channel) await channel.delete('Scrim deleted — auto-created group channel no longer needed');
      } catch (err) {
        console.error(`Failed to delete auto-created group channel ${channelId}:`, err);
      }
    }
    if (store.settings) {
      for (const channelId of autoGroupChannelIds) {
        const letter = Object.keys(store.settings.groupChannels || {}).find(l => store.settings.groupChannels[l] === channelId);
        if (letter) delete store.settings.groupChannels[letter];
      }
      store.settings.autoGroupChannelIds = [];
      store.settings.groupSlotListMessageIds = {};
      store.settings.groupRosterMessageIds = {};
      store.settings.groupRosterPublished = {};

      const categoryId = store.settings.groupChannelsCategoryId;
      if (categoryId) {
        try {
          const category = interaction.guild.channels.cache.get(categoryId);
          if (category && category.children.cache.size === 0) {
            await category.delete('Scrim deleted — group channel category now empty');
            store.settings.groupChannelsCategoryId = null;
          }
        } catch (err) {
          console.error(`Failed to delete now-empty group channel category ${categoryId}:`, err);
        }
      }
    }

    store.scrim = null;
    saveGuildStore(interaction.guildId, store);
    const payload = buildScrimWizardPayload(store);
    return interaction.update({ content: '🗑️ Scrim deleted.', ...payload });
  }

  if (id === 'scrim_wizard_delete_cancel') {
    const payload = buildScrimWizardPayload(store);
    return interaction.update({ content: '', ...payload });
  }
}

async function handleScrimCreateModalSubmit(interaction) {
  const store = getGuildStore(interaction.guildId);
  if (store.scrim) {
    return interaction.reply({ content: '❌ A scrim already exists.', flags: MessageFlags.Ephemeral });
  }

  const name = interaction.fields.getTextInputValue('name').trim();
  const slotsRaw = interaction.fields.getTextInputValue('slots').trim();
  const totalSlots = parseInt(slotsRaw, 10);

  if (!Number.isInteger(totalSlots) || totalSlots < 1 || totalSlots > 20000) {
    return interaction.reply({ content: '❌ Total slots must be a whole number between 1 and 20000 (1000 groups of 20).', flags: MessageFlags.Ephemeral });
  }

  store.scrim = { scrimName: name, totalSlots, slots: {}, createdDayNumber: todayDayNumber(), closedGroups: [] };
  saveGuildStore(interaction.guildId, store);

  const payload = buildScrimWizardPayload(store);
  await interaction.update(payload);
}

async function handleScrimEditModalSubmit(interaction) {
  const store = getGuildStore(interaction.guildId);
  if (!store.scrim) {
    return interaction.reply({ content: '❌ No scrim exists yet.', flags: MessageFlags.Ephemeral });
  }

  const name = interaction.fields.getTextInputValue('name').trim();
  const slotsRaw = interaction.fields.getTextInputValue('slots').trim();
  const totalSlots = parseInt(slotsRaw, 10);

  if (!Number.isInteger(totalSlots) || totalSlots < 1 || totalSlots > 20000) {
    return interaction.reply({ content: '❌ Total slots must be a whole number between 1 and 20000 (1000 groups of 20).', flags: MessageFlags.Ephemeral });
  }

  store.scrim.scrimName = name;
  store.scrim.totalSlots = totalSlots;
  saveGuildStore(interaction.guildId, store);

  const payload = buildScrimWizardPayload(store);
  await interaction.update(payload);
}

module.exports = {
  buildScrimWizardPayload,
  handleScrimWizardButton,
  handleScrimCreateModalSubmit,
  handleScrimEditModalSubmit,
};
