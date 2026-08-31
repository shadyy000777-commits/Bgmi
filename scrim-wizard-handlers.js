const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, PermissionFlagsBits,
} = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');
const { buildSlotListEmbed } = require('./embeds');

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
    .setColor(scrim.open ? 0x57F287 : 0xED4245)
    .addFields(
      { name: 'Status', value: scrim.open ? '🟢 Open' : '🔴 Closed', inline: true },
      { name: 'Slots Filled', value: `${filled}/${scrim.totalSlots}`, inline: true },
    );

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('scrim_wizard_toggle')
      .setLabel(scrim.open ? 'Close Registration' : 'Open Registration')
      .setEmoji(scrim.open ? '🔒' : '🔓')
      .setStyle(scrim.open ? ButtonStyle.Danger : ButtonStyle.Success),
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
          .setPlaceholder('e.g. 25').setRequired(true).setMaxLength(4)
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
          .setValue(String(scrim.totalSlots)).setRequired(true).setMaxLength(4)
      ),
    );
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

  if (id === 'scrim_wizard_toggle') {
    if (!store.scrim) {
      return interaction.reply({ content: '❌ No scrim exists yet.', flags: MessageFlags.Ephemeral });
    }

    if (store.scrim.open) {
      // Closing — mirror /scrim-close: strip registered/group roles and
      // reset the slot list so the next scrim starts clean.
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

      store.scrim.open = false;
      store.scrim.slots = {};
    } else {
      store.scrim.open = true;
    }

    saveGuildStore(interaction.guildId, store);
    const payload = buildScrimWizardPayload(store);
    await interaction.update(payload);
    await interaction.channel.send(
      store.scrim.open
        ? `✅ Registration opened for **${store.scrim.scrimName}** with **${store.scrim.totalSlots}** slots. Teams can now use \`/register\`.`
        : `🔒 Registration for **${store.scrim.scrimName}** is now closed.`
    ).catch(() => {});
    return;
  }

  if (id === 'scrim_wizard_slotlist') {
    if (!store.scrim) {
      return interaction.reply({ content: '❌ No scrim exists yet.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({ embeds: [buildSlotListEmbed(store.scrim)], flags: MessageFlags.Ephemeral });
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

  if (!Number.isInteger(totalSlots) || totalSlots < 1 || totalSlots > 240) {
    return interaction.reply({ content: '❌ Total slots must be a whole number between 1 and 240.', flags: MessageFlags.Ephemeral });
  }

  store.scrim = { open: false, scrimName: name, totalSlots, slots: {} };
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

  if (!Number.isInteger(totalSlots) || totalSlots < 1 || totalSlots > 240) {
    return interaction.reply({ content: '❌ Total slots must be a whole number between 1 and 240.', flags: MessageFlags.Ephemeral });
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
