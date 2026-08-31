const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, PermissionFlagsBits,
} = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');
const { buildGroupsEmbed } = require('./embeds');

const GROUP_LETTERS = 'ABCDEFGHIJKL'.split('');

function buildTournamentWizardPayload(store) {
  const tournament = store.tournament;

  if (!tournament) {
    const embed = new EmbedBuilder()
      .setTitle('🥇 Tournament Setup')
      .setColor(0x5865F2)
      .setDescription('No tournament is set up yet. Click **Create Tournament** to get started.');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tourney_wizard_create').setLabel('Create Tournament').setEmoji('➕').setStyle(ButtonStyle.Success)
    );

    return { embeds: [embed], components: [row] };
  }

  const groupCount = Object.keys(tournament.groups).length;
  const teamCount = Object.values(tournament.groups).reduce((sum, g) => sum + g.teams.length, 0);

  const embed = new EmbedBuilder()
    .setTitle(`🥇 Tournament Setup — ${tournament.name}`)
    .setColor(tournament.open ? 0x57F287 : 0xED4245)
    .addFields(
      { name: 'Status', value: tournament.open ? '🟢 Open' : '🔴 Closed', inline: true },
      { name: 'Groups', value: groupCount ? String(groupCount) : 'None yet', inline: true },
      { name: 'Teams Registered', value: String(teamCount), inline: true },
    );

  if (groupCount) {
    const groupLines = Object.entries(tournament.groups)
      .map(([letter, g]) => `**${letter}** — ${g.teams.length}/${g.capacity}`)
      .join('  •  ');
    embed.addFields({ name: 'Group Capacity', value: groupLines });
  }

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('tourney_wizard_toggle')
      .setLabel(tournament.open ? 'Close Registration' : 'Open Registration')
      .setEmoji(tournament.open ? '🔒' : '🔓')
      .setStyle(tournament.open ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId('tourney_wizard_add_group').setLabel('Add Group').setEmoji('➕').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tourney_wizard_view_groups').setLabel('View Groups').setEmoji('📋').setStyle(ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tourney_wizard_delete').setLabel('Delete Tournament').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row1, row2] };
}

function buildTournamentCreateModal() {
  return new ModalBuilder()
    .setCustomId('tourney_wizard_create_modal')
    .setTitle('Create Tournament')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('name').setLabel('Tournament name').setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. BGMI Winter Championship').setRequired(true).setMaxLength(80)
      ),
    );
}

function buildAddGroupModal() {
  return new ModalBuilder()
    .setCustomId('tourney_wizard_group_modal')
    .setTitle('Add Group')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('letter').setLabel('Group letter (A-L)').setStyle(TextInputStyle.Short)
          .setPlaceholder('A').setRequired(true).setMaxLength(1)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('capacity').setLabel('Team capacity').setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. 16').setRequired(true).setMaxLength(4)
      ),
    );
}

function hasManageGuild(interaction) {
  return interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
}

async function handleTournamentWizardButton(interaction) {
  if (!hasManageGuild(interaction)) {
    return interaction.reply({ content: '❌ You need the **Manage Server** permission to do that.', flags: MessageFlags.Ephemeral });
  }

  const store = getGuildStore(interaction.guildId);
  const id = interaction.customId;

  if (id === 'tourney_wizard_create') {
    if (store.tournament) {
      return interaction.reply({ content: '❌ A tournament already exists. Delete it first to create a new one.', flags: MessageFlags.Ephemeral });
    }
    return interaction.showModal(buildTournamentCreateModal());
  }

  if (id === 'tourney_wizard_add_group') {
    if (!store.tournament) {
      return interaction.reply({ content: '❌ No tournament exists yet.', flags: MessageFlags.Ephemeral });
    }
    if (Object.keys(store.tournament.groups).length >= GROUP_LETTERS.length) {
      return interaction.reply({ content: `❌ Max ${GROUP_LETTERS.length} groups (A-L) reached.`, flags: MessageFlags.Ephemeral });
    }
    return interaction.showModal(buildAddGroupModal());
  }

  if (id === 'tourney_wizard_toggle') {
    if (!store.tournament) {
      return interaction.reply({ content: '❌ No tournament exists yet.', flags: MessageFlags.Ephemeral });
    }
    if (!store.tournament.open && Object.keys(store.tournament.groups).length === 0) {
      return interaction.reply({ content: '❌ Add at least one group before opening registration.', flags: MessageFlags.Ephemeral });
    }
    store.tournament.open = !store.tournament.open;
    saveGuildStore(interaction.guildId, store);
    const payload = buildTournamentWizardPayload(store);
    await interaction.update(payload);
    await interaction.channel.send(
      store.tournament.open
        ? `✅ Registration opened for **${store.tournament.name}**. Teams can now register.`
        : `🔒 Registration for **${store.tournament.name}** is now closed.`
    ).catch(() => {});
    return;
  }

  if (id === 'tourney_wizard_view_groups') {
    if (!store.tournament) {
      return interaction.reply({ content: '❌ No tournament exists yet.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({ embeds: [buildGroupsEmbed(store.tournament)], flags: MessageFlags.Ephemeral });
  }

  if (id === 'tourney_wizard_delete') {
    if (!store.tournament) {
      return interaction.reply({ content: '❌ No tournament exists yet.', flags: MessageFlags.Ephemeral });
    }
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tourney_wizard_delete_confirm').setLabel('Yes, delete it').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('tourney_wizard_delete_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );
    return interaction.update({
      content: `⚠️ Delete **${store.tournament.name}** and all groups/registrations? This can't be undone.`,
      embeds: [],
      components: [row],
    });
  }

  if (id === 'tourney_wizard_delete_confirm') {
    store.tournament = null;
    saveGuildStore(interaction.guildId, store);
    const payload = buildTournamentWizardPayload(store);
    return interaction.update({ content: '🗑️ Tournament deleted.', ...payload });
  }

  if (id === 'tourney_wizard_delete_cancel') {
    const payload = buildTournamentWizardPayload(store);
    return interaction.update({ content: '', ...payload });
  }
}

async function handleTournamentCreateModalSubmit(interaction) {
  const store = getGuildStore(interaction.guildId);
  if (store.tournament) {
    return interaction.reply({ content: '❌ A tournament already exists.', flags: MessageFlags.Ephemeral });
  }

  const name = interaction.fields.getTextInputValue('name').trim();
  store.tournament = { name, open: false, groups: {}, qualified: [] };
  saveGuildStore(interaction.guildId, store);

  const payload = buildTournamentWizardPayload(store);
  await interaction.update(payload);
}

async function handleAddGroupModalSubmit(interaction) {
  const store = getGuildStore(interaction.guildId);
  if (!store.tournament) {
    return interaction.reply({ content: '❌ No tournament exists yet.', flags: MessageFlags.Ephemeral });
  }

  const letter = interaction.fields.getTextInputValue('letter').trim().toUpperCase();
  const capacityRaw = interaction.fields.getTextInputValue('capacity').trim();
  const capacity = parseInt(capacityRaw, 10);

  if (!GROUP_LETTERS.includes(letter)) {
    return interaction.reply({ content: `❌ Group letter must be a single letter A-${GROUP_LETTERS[GROUP_LETTERS.length - 1]}.`, flags: MessageFlags.Ephemeral });
  }
  if (store.tournament.groups[letter]) {
    return interaction.reply({ content: `❌ Group **${letter}** already exists.`, flags: MessageFlags.Ephemeral });
  }
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 64) {
    return interaction.reply({ content: '❌ Capacity must be a whole number between 1 and 64.', flags: MessageFlags.Ephemeral });
  }

  store.tournament.groups[letter] = { capacity, teams: [] };
  saveGuildStore(interaction.guildId, store);

  const payload = buildTournamentWizardPayload(store);
  await interaction.update(payload);
}

module.exports = {
  buildTournamentWizardPayload,
  handleTournamentWizardButton,
  handleTournamentCreateModalSubmit,
  handleAddGroupModalSubmit,
};
