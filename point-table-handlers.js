const {
  ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle, FileUploadBuilder,
  MessageFlags, PermissionFlagsBits,
} = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');
const { readLobbyScreenshots, readResultScreenshots } = require('./point-table-ai');
const {
  parseSlotlistText, calculatePointTable, buildPointTableResultEmbed,
} = require('./point-table');

function requireManageGuild(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    interaction.reply({ content: '❌ You need the **Manage Server** permission to do that.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return false;
  }
  return true;
}

// ---------- Construct PT ----------

function buildConstructModal() {
  const modal = new ModalBuilder().setCustomId('pt_construct_modal').setTitle('Construct Point Table');

  const slotlistInput = new TextInputBuilder()
    .setCustomId('slotlist')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('1. Team Name @user\n2. Team Name @user\n...')
    .setMaxLength(3000)
    .setRequired(false);
  const slotlistLabel = new LabelBuilder()
    .setLabel('Paste Slotlist (leave blank to use scrim)')
    .setTextInputComponent(slotlistInput);

  const lobbyUpload = new FileUploadBuilder()
    .setCustomId('lobby_screenshots')
    .setMinValues(1)
    .setMaxValues(5)
    .setRequired(true);
  const lobbyLabel = new LabelBuilder()
    .setLabel('Lobby Screenshots — 1 to 5 images')
    .setFileUploadComponent(lobbyUpload);

  const resultUpload = new FileUploadBuilder()
    .setCustomId('result_screenshots')
    .setMinValues(1)
    .setMaxValues(10)
    .setRequired(true);
  const resultLabel = new LabelBuilder()
    .setLabel('Result Screenshots — 1 to 10 images')
    .setFileUploadComponent(resultUpload);

  modal.addLabelComponents(slotlistLabel, lobbyLabel, resultLabel);
  return modal;
}

async function handleConstructPTButton(interaction) {
  await interaction.showModal(buildConstructModal());
}

async function handleConstructPTModalSubmit(interaction) {
  // Reading + reasoning over up to 15 screenshots can easily take longer
  // than the 3-second interaction ack window, so defer immediately and do
  // all the real work after.
  await interaction.deferReply();

  const slotlistText = interaction.fields.getTextInputValue('slotlist') || '';
  const lobbyFiles = [...interaction.fields.getUploadedFiles('lobby_screenshots').values()];
  const resultFiles = [...interaction.fields.getUploadedFiles('result_screenshots').values()];

  const nonImage = [...lobbyFiles, ...resultFiles].find(f => f.contentType && !f.contentType.startsWith('image/'));
  if (nonImage) {
    return interaction.editReply(`❌ **${nonImage.name}** isn't an image — please upload only screenshots.`);
  }

  const store = getGuildStore(interaction.guildId);

  try {
    let roster;
    if (slotlistText.trim()) {
      roster = parseSlotlistText(slotlistText);
    } else {
      const lobbyResult = await readLobbyScreenshots(lobbyFiles.map(f => f.url), '');
      roster = lobbyResult.teams;
    }

    const { matches } = await readResultScreenshots(resultFiles.map(f => f.url));

    if (!matches.length) {
      return interaction.editReply('❌ Couldn\'t read any match results from those screenshots. Try clearer/uncropped images of the results screen.');
    }

    const rows = calculatePointTable(matches, store.pointTable.pointsSystem, roster);
    if (!rows.length) {
      return interaction.editReply('❌ Read the screenshots but found no teams to rank — double check the result screenshots show a placement + kills table.');
    }

    const embed = buildPointTableResultEmbed(rows, matches, store.pointTable.design, store.scrim?.scrimName);
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error('[point-table] Failed to construct point table:', err);
    await interaction.editReply('❌ Something went wrong reading those screenshots. Please try again in a moment.');
  }
}

// ---------- Set Points System ----------

function buildPointsModal(store) {
  const { killPoints, placements } = store.pointTable.pointsSystem;
  const placementOrder = Object.keys(placements).map(Number).sort((a, b) => a - b);
  const placementsCsv = placementOrder.map(p => placements[p]).join(',');

  const modal = new ModalBuilder().setCustomId('pt_points_modal').setTitle('Set Points System');

  const killInput = new TextInputBuilder()
    .setCustomId('kill_points')
    .setStyle(TextInputStyle.Short)
    .setValue(String(killPoints))
    .setRequired(true)
    .setMaxLength(5);
  const killLabel = new LabelBuilder().setLabel('Points per kill').setTextInputComponent(killInput);

  const placementsInput = new TextInputBuilder()
    .setCustomId('placement_points')
    .setStyle(TextInputStyle.Paragraph)
    .setValue(placementsCsv)
    .setRequired(true)
    .setMaxLength(300);
  const placementsLabel = new LabelBuilder()
    .setLabel(`Placement points, 1st→${placementOrder.length}th (comma-separated)`)
    .setDescription('e.g. 15,12,10,8,6,4,2,1,1,1,0,0,0,0,0,0')
    .setTextInputComponent(placementsInput);

  modal.addLabelComponents(killLabel, placementsLabel);
  return modal;
}

async function handleSetPointsButton(interaction) {
  if (!requireManageGuild(interaction)) return;
  const store = getGuildStore(interaction.guildId);
  await interaction.showModal(buildPointsModal(store));
}

async function handleSetPointsModalSubmit(interaction) {
  const killPointsRaw = interaction.fields.getTextInputValue('kill_points');
  const placementsRaw = interaction.fields.getTextInputValue('placement_points');

  const killPoints = Number(killPointsRaw);
  if (!Number.isFinite(killPoints) || killPoints < 0) {
    return interaction.reply({ content: '❌ Points per kill must be a non-negative number.', flags: MessageFlags.Ephemeral });
  }

  const parts = placementsRaw.split(',').map(s => s.trim()).filter(s => s !== '');
  if (!parts.length || parts.some(p => !Number.isFinite(Number(p)))) {
    return interaction.reply({ content: '❌ Placement points must be a comma-separated list of numbers, e.g. `15,12,10,8,6`.', flags: MessageFlags.Ephemeral });
  }

  const placements = {};
  parts.forEach((p, idx) => { placements[String(idx + 1)] = Number(p); });

  const store = getGuildStore(interaction.guildId);
  store.pointTable.pointsSystem = { killPoints, placements };
  saveGuildStore(interaction.guildId, store);

  await interaction.reply({
    content: `✅ Points system updated: **${killPoints} pt(s) per kill**, placements 1st→${parts.length}th = \`${parts.join(', ')}\`.`,
    flags: MessageFlags.Ephemeral,
  });
}

// ---------- Design PT ----------

function buildDesignModal(store) {
  const { serverName, instagram, discordInvite, youtube } = store.pointTable.design;
  const modal = new ModalBuilder().setCustomId('pt_design_modal').setTitle('Design Point Table');

  const nameInput = new TextInputBuilder().setCustomId('server_name').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100);
  if (serverName) nameInput.setValue(serverName);
  const nameLabel = new LabelBuilder().setLabel('Server name').setTextInputComponent(nameInput);

  const igInput = new TextInputBuilder().setCustomId('instagram').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100);
  if (instagram) igInput.setValue(instagram);
  const igLabel = new LabelBuilder().setLabel('Instagram handle').setTextInputComponent(igInput);

  const discordInput = new TextInputBuilder().setCustomId('discord_invite').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100);
  if (discordInvite) discordInput.setValue(discordInvite);
  const discordLabel = new LabelBuilder().setLabel('Discord invite').setTextInputComponent(discordInput);

  const ytInput = new TextInputBuilder().setCustomId('youtube').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100);
  if (youtube) ytInput.setValue(youtube);
  const ytLabel = new LabelBuilder().setLabel('YouTube handle').setTextInputComponent(ytInput);

  modal.addLabelComponents(nameLabel, igLabel, discordLabel, ytLabel);
  return modal;
}

async function handleDesignPTButton(interaction) {
  if (!requireManageGuild(interaction)) return;
  const store = getGuildStore(interaction.guildId);
  await interaction.showModal(buildDesignModal(store));
}

async function handleDesignPTModalSubmit(interaction) {
  const store = getGuildStore(interaction.guildId);
  store.pointTable.design = {
    serverName: interaction.fields.getTextInputValue('server_name') || null,
    instagram: interaction.fields.getTextInputValue('instagram') || null,
    discordInvite: interaction.fields.getTextInputValue('discord_invite') || null,
    youtube: interaction.fields.getTextInputValue('youtube') || null,
  };
  saveGuildStore(interaction.guildId, store);

  await interaction.reply({ content: '✅ Point table branding updated.', flags: MessageFlags.Ephemeral });
}

// ---------- Router ----------

async function handlePointTableButton(interaction) {
  if (interaction.customId === 'pt_construct') return handleConstructPTButton(interaction);
  if (interaction.customId === 'pt_set_points') return handleSetPointsButton(interaction);
  if (interaction.customId === 'pt_design') return handleDesignPTButton(interaction);
}

async function handlePointTableModalSubmit(interaction) {
  if (interaction.customId === 'pt_construct_modal') return handleConstructPTModalSubmit(interaction);
  if (interaction.customId === 'pt_points_modal') return handleSetPointsModalSubmit(interaction);
  if (interaction.customId === 'pt_design_modal') return handleDesignPTModalSubmit(interaction);
}

module.exports = { handlePointTableButton, handlePointTableModalSubmit };
