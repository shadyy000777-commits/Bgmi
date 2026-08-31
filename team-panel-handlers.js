const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, PermissionFlagsBits,
} = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');

function buildTeamPanelPayload(role) {
  const embed = new EmbedBuilder()
    .setTitle('📁 Team Panel')
    .setColor(0x5865F2)
    .setDescription(`Manage your team profile here. Restricted to ${role}.`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('team_panel_create').setLabel('Create Team').setEmoji('➕').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('team_panel_edit').setLabel('Edit Team').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('team_panel_delete').setLabel('Delete Team').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row] };
}

function buildTeamModal(existing) {
  return new ModalBuilder()
    .setCustomId('team_panel_modal')
    .setTitle(existing ? 'Edit Team' : 'Create Team')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('teamName').setLabel('Team name').setStyle(TextInputStyle.Short)
          .setValue(existing ? existing.teamName : '').setRequired(true).setMaxLength(80)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('players').setLabel('Players (one per line)').setStyle(TextInputStyle.Paragraph)
          .setValue(existing ? existing.players.join('\n') : '')
          .setPlaceholder('IGN 1\nIGN 2\nIGN 3\nIGN 4')
          .setRequired(true).setMaxLength(400)
      ),
    );
}

// Members with Manage Server can always use the panel, even without the
// restricted role — same bypass pattern used across the other panels.
function isAllowed(interaction, store) {
  if (interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  const roleId = store.settings && store.settings.teamPanelRoleId;
  if (!roleId) return true;
  return interaction.member.roles.cache.has(roleId);
}

async function handleTeamPanelButton(interaction) {
  const store = getGuildStore(interaction.guildId);

  if (!isAllowed(interaction, store)) {
    return interaction.reply({ content: "❌ You don't have the role required to use this panel.", flags: MessageFlags.Ephemeral });
  }

  const id = interaction.customId;
  const existing = store.teams[interaction.user.id];

  if (id === 'team_panel_create') {
    if (existing) {
      return interaction.reply({ content: '❌ You already have a team — use **Edit Team** instead.', flags: MessageFlags.Ephemeral });
    }
    return interaction.showModal(buildTeamModal(null));
  }

  if (id === 'team_panel_edit') {
    if (!existing) {
      return interaction.reply({ content: "❌ You don't have a team yet — use **Create Team** first.", flags: MessageFlags.Ephemeral });
    }
    return interaction.showModal(buildTeamModal(existing));
  }

  if (id === 'team_panel_delete') {
    if (!existing) {
      return interaction.reply({ content: "❌ You don't have a team yet.", flags: MessageFlags.Ephemeral });
    }
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('team_panel_delete_confirm').setLabel('Yes, delete it').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('team_panel_delete_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );
    return interaction.reply({
      content: `⚠️ Delete your team **${existing.teamName}**? This can't be undone.`,
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (id === 'team_panel_delete_confirm') {
    delete store.teams[interaction.user.id];
    saveGuildStore(interaction.guildId, store);
    return interaction.update({ content: '🗑️ Your team has been deleted.', components: [] });
  }

  if (id === 'team_panel_delete_cancel') {
    return interaction.update({ content: 'Cancelled.', components: [] });
  }
}

async function handleTeamPanelModalSubmit(interaction) {
  const store = getGuildStore(interaction.guildId);

  if (!isAllowed(interaction, store)) {
    return interaction.reply({ content: "❌ You don't have the role required to use this panel.", flags: MessageFlags.Ephemeral });
  }

  const teamName = interaction.fields.getTextInputValue('teamName').trim();
  const players = interaction.fields.getTextInputValue('players')
    .split('\n').map(p => p.trim()).filter(Boolean);

  if (!players.length) {
    return interaction.reply({ content: '❌ Add at least one player.', flags: MessageFlags.Ephemeral });
  }

  store.teams[interaction.user.id] = { teamName, players, updatedAt: Date.now() };
  saveGuildStore(interaction.guildId, store);

  const embed = new EmbedBuilder()
    .setTitle(`✅ Team Saved — ${teamName}`)
    .setColor(0x57F287)
    .addFields({ name: 'Players', value: players.join('\n') });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

module.exports = {
  buildTeamPanelPayload,
  handleTeamPanelButton,
  handleTeamPanelModalSubmit,
};
