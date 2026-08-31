const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder,
  MessageFlags, PermissionFlagsBits,
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

// Builds the "pick qualifying teams" select menu for one group — the same
// picker whether triggered from a button elsewhere or the !qualify command.
// Returns { error } instead of a payload when the group can't be shown.
function buildQualifySelectPayload(tournament, letter) {
  if (!letter) {
    return { error: "❌ Couldn't tell which group this channel is for. Name the channel like **group-a**, or run `!qualify <letter>` (e.g. `!qualify A`)." };
  }

  const group = tournament.groups[letter];
  if (!group) {
    const existing = Object.keys(tournament.groups).join(', ') || 'none yet';
    return { error: `❌ Group **${letter}** doesn't exist. Current groups: ${existing}.` };
  }
  if (!group.teams.length) {
    return { error: `❌ Group **${letter}** has no registered teams yet.` };
  }
  if (group.teams.length > 25) {
    return { error: `❌ Group **${letter}** has ${group.teams.length} teams — Discord select menus cap at 25 options, so this group can't be shown as one list.` };
  }

  const alreadyQualified = new Set(tournament.qualified);
  const select = new StringSelectMenuBuilder()
    .setCustomId(`qualify_select_teams:${letter}`)
    .setPlaceholder(`Select qualifying teams from Group ${letter}`)
    .setMinValues(0)
    .setMaxValues(group.teams.length)
    .addOptions(group.teams.map((t, idx) => ({
      label: t.team.slice(0, 100),
      value: String(idx),
      default: alreadyQualified.has(t.team),
    })));

  const embed = new EmbedBuilder()
    .setTitle(`✅ Qualify Teams — Group ${letter}`)
    .setColor(0x5865F2)
    .setDescription('Select every team from this group that qualifies, then confirm. Already-qualified teams are pre-checked.');

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
}

async function handleQualifySelect(interaction) {
  if (!hasManageGuild(interaction)) {
    return interaction.reply({ content: '❌ You need the **Manage Server** permission to do that.', flags: MessageFlags.Ephemeral });
  }

  const [, letter] = interaction.customId.split(':');
  const store = getGuildStore(interaction.guildId);
  const tournament = store.tournament;

  if (!tournament || !tournament.groups[letter]) {
    return interaction.update({ content: '❌ That group no longer exists.', embeds: [], components: [] });
  }

  const group = tournament.groups[letter];
  const selectedTeams = interaction.values.map(v => group.teams[parseInt(v, 10)]?.team).filter(Boolean);

  // Re-running qualify on the same group cleanly replaces its previous
  // picks rather than piling up duplicates: drop every team from this
  // group out of the qualified list first, then add back only what's
  // selected now.
  const groupTeamNames = new Set(group.teams.map(t => t.team));
  tournament.qualified = tournament.qualified.filter(name => !groupTeamNames.has(name));
  tournament.qualified.push(...selectedTeams);
  saveGuildStore(interaction.guildId, store);

  await interaction.update({
    content: `✅ Group **${letter}** qualifiers updated: ${selectedTeams.length ? selectedTeams.map(t => `**${t}**`).join(', ') : '_none selected_'}`,
    embeds: [],
    components: [],
  });
}

module.exports = {
  buildTournamentWizardPayload,
  handleTournamentWizardButton,
  handleTournamentCreateModalSubmit,
  handleAddGroupModalSubmit,
  buildQualifySelectPayload,
  handleQualifySelect,
};
