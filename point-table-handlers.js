const crypto = require('crypto');
const {
  ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle, FileUploadBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  AttachmentBuilder, MessageFlags, PermissionFlagsBits,
} = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');
const { readLobbyScreenshots, readResultScreenshots } = require('./point-table-ai');
const { parseSlotlistText, calculatePointTable, normalizeName } = require('./point-table');
const { renderPointTableImage, themeNames, getTheme } = require('./point-table-image');

function requireManageGuild(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    interaction.reply({ content: '❌ You need the **Manage Server** permission to do that.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return false;
  }
  return true;
}

// Short-lived cache of the last few generated point tables, keyed by a
// random id embedded in the result message's button customIds. This is
// what lets "Edit" and "Change Design" find their way back to the right
// message later. Deliberately in-memory (not storage.js) — losing an
// in-progress edit session on a redeploy is an acceptable trade-off, same
// as Discord's own component-interaction state.
const resultCache = new Map();
const RESULT_CACHE_MAX = 200;

function cacheResult(entry) {
  const id = crypto.randomBytes(4).toString('hex');
  resultCache.set(id, entry);
  if (resultCache.size > RESULT_CACHE_MAX) {
    resultCache.delete(resultCache.keys().next().value);
  }
  return id;
}

function buildResultComponents(resultId) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pt_result_getdata:${resultId}`).setLabel('Get Data').setEmoji('🔒').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`pt_result_edit:${resultId}`).setLabel('Edit').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`pt_result_design:${resultId}`).setLabel('Change Design').setEmoji('🎨').setStyle(ButtonStyle.Secondary),
  )];
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

// Renders the little "☑ Slotlist verified — 20 slots." progress list,
// checking off each line as it completes.
function renderChecklist(steps) {
  return steps.map(s => `${s.done ? '✅' : '⬜'} ${s.text}`).join('\n');
}

async function handleConstructPTModalSubmit(interaction) {
  // Reading + reasoning over up to 15 screenshots (one Groq request per
  // image, spaced out to respect rate limits) easily takes longer than the
  // 3-second interaction ack window, so defer immediately.
  await interaction.deferReply();

  const slotlistText = interaction.fields.getTextInputValue('slotlist') || '';
  const lobbyFiles = [...interaction.fields.getUploadedFiles('lobby_screenshots').values()];
  const resultFiles = [...interaction.fields.getUploadedFiles('result_screenshots').values()];

  const nonImage = [...lobbyFiles, ...resultFiles].find(f => f.contentType && !f.contentType.startsWith('image/'));
  if (nonImage) {
    return interaction.editReply(`❌ **${nonImage.name}** isn't an image — please upload only screenshots.`);
  }

  const store = getGuildStore(interaction.guildId);
  const usingSlotlist = Boolean(slotlistText.trim());

  const steps = usingSlotlist
    ? [{ text: `Slotlist verified — parsing pasted list.`, done: false }, { text: 'Results analyzed.', done: false }, { text: 'Point Table created and sent!', done: false }]
    : [{ text: 'Lobby analyzed.', done: false }, { text: 'Results analyzed.', done: false }, { text: 'Point Table created and sent!', done: false }];

  const updateChecklist = () => interaction.editReply(renderChecklist(steps)).catch(() => {});
  await updateChecklist();

  try {
    let roster;
    if (usingSlotlist) {
      roster = parseSlotlistText(slotlistText);
      steps[0].text = `Slotlist verified — ${roster.length} slot(s).`;
      steps[0].done = true;
    } else {
      const lobbyResult = await readLobbyScreenshots(lobbyFiles.map(f => f.url), '');
      roster = lobbyResult.teams;
      steps[0].text = `Lobby analyzed — ${roster.length} team(s) found.`;
      steps[0].done = true;
    }
    await updateChecklist();

    const { matches } = await readResultScreenshots(resultFiles.map(f => f.url));

    if (!matches.length) {
      steps[1].text = 'Results analyzed — nothing readable found.';
      await updateChecklist();
      return interaction.followUp('❌ Couldn\'t read any match results from those screenshots. Try clearer/uncropped images of the results screen.');
    }

    const teamsParsed = new Set(matches.flatMap(m => (m.results || []).map(r => normalizeName(r.teamName)))).size;
    steps[1].text = `Results analyzed — ${teamsParsed} team(s) parsed.`;
    steps[1].done = true;
    await updateChecklist();

    const { rows, issues } = calculatePointTable(matches, store.pointTable.pointsSystem, roster);
    if (!rows.length) {
      return interaction.followUp('❌ Read the screenshots but found no teams to rank — double check the result screenshots show a placement + kills table.');
    }

    const theme = store.pointTable.design.theme;
    const imageBuffer = renderPointTableImage(rows, store.pointTable.design, theme);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'point_table.png' });

    steps[2].done = true;
    await updateChecklist();

    const resultId = cacheResult({
      guildId: interaction.guildId,
      rows, matches, roster,
      pointsSystem: store.pointTable.pointsSystem,
      scrimName: store.scrim?.scrimName,
    });

    let content = `**Point Table — <@${interaction.user.id}>**`;
    if (issues.length) {
      const issueText = issues.slice(0, 6).join('\n') + (issues.length > 6 ? `\n_+${issues.length - 6} more._` : '');
      content += `\n\n⚠️ **Please double-check:**\n${issueText}`;
    }

    const sent = await interaction.followUp({ content, files: [attachment], components: buildResultComponents(resultId) });
    const cached = resultCache.get(resultId);
    if (cached) { cached.channelId = sent.channel.id; cached.messageId = sent.id; }
  } catch (err) {
    console.error('[point-table] Failed to construct point table:', err);
    await interaction.followUp('❌ Something went wrong reading those screenshots. Please try again in a moment.').catch(() => {});
  }
}

// ---------- Result buttons: Get Data / Edit / Change Design ----------

async function handleGetDataButton(interaction, resultId) {
  const cached = resultCache.get(resultId);
  if (!cached) {
    return interaction.reply({ content: '❌ This point table has expired — construct a new one to get fresh data.', flags: MessageFlags.Ephemeral });
  }
  const payload = { rows: cached.rows, matches: cached.matches, roster: cached.roster };
  const buffer = Buffer.from(JSON.stringify(payload, null, 2), 'utf-8');
  const attachment = new AttachmentBuilder(buffer, { name: 'point_table_data.json' });
  await interaction.reply({ content: 'Raw data for this point table:', files: [attachment], flags: MessageFlags.Ephemeral });
}

async function handleEditButton(interaction, resultId) {
  const cached = resultCache.get(resultId);
  if (!cached) {
    return interaction.reply({ content: '❌ This point table has expired — construct a new one to edit.', flags: MessageFlags.Ephemeral });
  }
  const options = cached.rows.slice(0, 25).map((r, i) => ({
    label: r.teamName.slice(0, 100),
    description: `Kills: ${r.kills} · Placement pts: ${r.placementPoints} · Total: ${r.totalPoints}`,
    value: String(i),
  }));
  const select = new StringSelectMenuBuilder()
    .setCustomId(`pt_edit_select:${resultId}`)
    .setPlaceholder('Select a team to correct')
    .addOptions(options);

  await interaction.reply({
    content: 'Which team\'s numbers need correcting?',
    components: [new ActionRowBuilder().addComponents(select)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleEditSelect(interaction, resultId) {
  const cached = resultCache.get(resultId);
  if (!cached) {
    return interaction.reply({ content: '❌ This point table has expired.', flags: MessageFlags.Ephemeral });
  }
  const teamIndex = Number(interaction.values[0]);
  const row = cached.rows[teamIndex];
  if (!row) return interaction.reply({ content: '❌ Team not found.', flags: MessageFlags.Ephemeral });

  const modal = new ModalBuilder().setCustomId(`pt_edit_modal:${resultId}:${teamIndex}`).setTitle(`Edit — ${row.teamName.slice(0, 40)}`);

  const killsInput = new TextInputBuilder().setCustomId('kills').setStyle(TextInputStyle.Short).setValue(String(row.kills)).setRequired(true).setMaxLength(5);
  const killsLabel = new LabelBuilder().setLabel('Kills (FP)').setTextInputComponent(killsInput);

  const placementInput = new TextInputBuilder().setCustomId('placement_points').setStyle(TextInputStyle.Short).setValue(String(row.placementPoints)).setRequired(true).setMaxLength(5);
  const placementLabel = new LabelBuilder().setLabel('Placement points (PP)').setTextInputComponent(placementInput);

  modal.addLabelComponents(killsLabel, placementLabel);
  await interaction.showModal(modal);
}

async function regenerateResultMessage(interaction, cached) {
  const store = getGuildStore(cached.guildId);
  const theme = store.pointTable.design.theme;
  const imageBuffer = renderPointTableImage(cached.rows, store.pointTable.design, theme);
  const attachment = new AttachmentBuilder(imageBuffer, { name: 'point_table.png' });

  const channel = await interaction.client.channels.fetch(cached.channelId).catch(() => null);
  const message = channel && await channel.messages.fetch(cached.messageId).catch(() => null);
  if (!message) throw new Error('Could not find the original point table message to update.');

  await message.edit({ files: [attachment], attachments: [] });
}

async function handleEditModalSubmit(interaction, resultId, teamIndexRaw) {
  const cached = resultCache.get(resultId);
  if (!cached) {
    return interaction.reply({ content: '❌ This point table has expired.', flags: MessageFlags.Ephemeral });
  }
  const teamIndex = Number(teamIndexRaw);
  const row = cached.rows[teamIndex];
  if (!row) return interaction.reply({ content: '❌ Team not found.', flags: MessageFlags.Ephemeral });

  const kills = Number(interaction.fields.getTextInputValue('kills'));
  const placementPoints = Number(interaction.fields.getTextInputValue('placement_points'));
  if (!Number.isFinite(kills) || !Number.isFinite(placementPoints)) {
    return interaction.reply({ content: '❌ Both values must be numbers.', flags: MessageFlags.Ephemeral });
  }

  row.kills = kills;
  row.placementPoints = placementPoints;
  row.totalPoints = placementPoints + kills * cached.pointsSystem.killPoints;
  cached.rows.sort((a, b) => b.totalPoints - a.totalPoints || b.kills - a.kills);

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await regenerateResultMessage(interaction, cached);
    await interaction.editReply(`✅ Updated **${row.teamName}** — the point table has been refreshed.`);
  } catch (err) {
    console.error('[point-table] Failed to apply edit:', err);
    await interaction.editReply('❌ Updated the numbers, but couldn\'t refresh the posted image — it may have been deleted.');
  }
}

async function handleDesignSelectButton(interaction, resultId) {
  const cached = resultCache.get(resultId);
  if (!cached) {
    return interaction.reply({ content: '❌ This point table has expired.', flags: MessageFlags.Ephemeral });
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(`pt_design_select:${resultId}`)
    .setPlaceholder('Pick a color theme')
    .addOptions(themeNames().map(key => ({ label: getTheme(key).name, value: key })));

  await interaction.reply({ content: 'Pick a theme for this point table:', components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral });
}

async function handleDesignSelect(interaction, resultId) {
  const cached = resultCache.get(resultId);
  if (!cached) {
    return interaction.reply({ content: '❌ This point table has expired.', flags: MessageFlags.Ephemeral });
  }
  const themeKey = interaction.values[0];

  const store = getGuildStore(cached.guildId);
  store.pointTable.design.theme = themeKey;
  saveGuildStore(cached.guildId, store);

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await regenerateResultMessage(interaction, cached);
    await interaction.editReply(`✅ Switched to the **${getTheme(themeKey).name}** theme.`);
  } catch (err) {
    console.error('[point-table] Failed to apply theme:', err);
    await interaction.editReply('❌ Saved the theme, but couldn\'t refresh the posted image — it may have been deleted.');
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
    ...store.pointTable.design,
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
  const [action, resultId] = interaction.customId.split(':');
  if (action === 'pt_construct') return handleConstructPTButton(interaction);
  if (action === 'pt_set_points') return handleSetPointsButton(interaction);
  if (action === 'pt_design') return handleDesignPTButton(interaction);
  if (action === 'pt_result_getdata') return handleGetDataButton(interaction, resultId);
  if (action === 'pt_result_edit') return handleEditButton(interaction, resultId);
  if (action === 'pt_result_design') return handleDesignSelectButton(interaction, resultId);
}

async function handlePointTableSelectMenu(interaction) {
  const [action, resultId] = interaction.customId.split(':');
  if (action === 'pt_edit_select') return handleEditSelect(interaction, resultId);
  if (action === 'pt_design_select') return handleDesignSelect(interaction, resultId);
}

async function handlePointTableModalSubmit(interaction) {
  if (interaction.customId === 'pt_construct_modal') return handleConstructPTModalSubmit(interaction);
  if (interaction.customId === 'pt_points_modal') return handleSetPointsModalSubmit(interaction);
  if (interaction.customId === 'pt_design_modal') return handleDesignPTModalSubmit(interaction);
  if (interaction.customId.startsWith('pt_edit_modal:')) {
    const [, resultId, teamIndex] = interaction.customId.split(':');
    return handleEditModalSubmit(interaction, resultId, teamIndex);
  }
}

module.exports = { handlePointTableButton, handlePointTableModalSubmit, handlePointTableSelectMenu };
