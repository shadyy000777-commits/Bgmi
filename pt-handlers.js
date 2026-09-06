const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, PermissionFlagsBits,
} = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');

// Original implementation — not affiliated with or copied from any other
// bot. Uses Groq's vision-capable models (same free-tier API already used
// by ai-chat.js) to read lobby/result screenshots and draft a point table,
// which a staff member then reviews before it's posted anywhere.
//
// Screenshots are collected via the /construct-pt SLASH COMMAND (see
// cmd-construct-pt.js), not a button + modal — Discord modals only support
// text fields, they can't take file uploads at all. A slash command's
// attachment-type options are the one place Discord lets you upload files
// directly as part of filling in a command, so that's what gives the
// "Upload Files" experience.

const DEFAULT_POINTS_SYSTEM = {
  killPoints: 1,
  // Index 0 = 1st place, index 1 = 2nd place, etc. Anything past the end
  // of this list (or an out-of-range placement) just scores 0 — fully
  // editable per-server via "Set Points System".
  placementPoints: [10, 6, 5, 4, 3, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0],
};

// In-memory only (not saved to data.json) — the most recent /construct-pt
// preview for one admin in one guild, kept around just long enough for
// them to hit Finalize/Re-run/Cancel. Resets on restart — worst case an
// abandoned preview just has to be re-run.
const sessions = new Map();
function sessionKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function hasManageGuild(interaction) {
  return interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
}

function row(input) {
  return new ActionRowBuilder().addComponents(input);
}

// ---------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------

function buildPtPanel(store, guild) {
  const pointsSystem = store.settings.pointsSystem || DEFAULT_POINTS_SYSTEM;
  const design = store.settings.ptDesign || {};

  const embed = new EmbedBuilder()
    .setTitle('🏆 Point Table Maker')
    .setColor(0x5865F2)
    .setDescription(
      'Build a match point table straight from your lobby & result screenshots — AI reads them and drafts the table for you to review before it goes out.\n\n' +
      '➕ **Construct PT** — run `/construct-pt` to upload your lobby + result screenshots (and an optional slot list) directly.\n' +
      '⚙️ **Set Points System** — configure kill points and placement points for this server.\n' +
      '🎨 **Design PT** — add your server name and socials to the table footer.'
    )
    .addFields(
      { name: 'Kill Points', value: `${pointsSystem.killPoints}`, inline: true },
      { name: 'Placement Points', value: pointsSystem.placementPoints.join(', '), inline: true },
      { name: 'Server Name', value: design.serverName || guild.name, inline: true },
    )
    .setFooter({ text: 'Beta — AI reads can misjudge a name or kill count, so always check the preview before posting.' });

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('pt_construct').setLabel('Construct PT').setEmoji('➕').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('pt_set_points').setLabel('Set Points System').setEmoji('⚙️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('pt_design').setLabel('Design PT').setEmoji('🎨').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [buttons] };
}

// ---------------------------------------------------------------------
// Modals (text-only settings — screenshots themselves go through the
// /construct-pt slash command, see runConstructPt below)
// ---------------------------------------------------------------------

function buildPointsModal(current) {
  const modal = new ModalBuilder().setCustomId('pt_points_modal').setTitle('Set Points System');

  const kill = new TextInputBuilder()
    .setCustomId('kill_points').setLabel('Points per kill')
    .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(6)
    .setValue(String(current.killPoints));

  const placement = new TextInputBuilder()
    .setCustomId('placement_points').setLabel('Placement points (1st, 2nd, 3rd, ...)')
    .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(300)
    .setPlaceholder('10,6,5,4,3,2,1,1,0,0,0,0,0,0,0,0')
    .setValue(current.placementPoints.join(','));

  modal.addComponents(row(kill), row(placement));
  return modal;
}

function buildDesignModal(current) {
  const modal = new ModalBuilder().setCustomId('pt_design_modal').setTitle('Design PT');

  const serverName = new TextInputBuilder()
    .setCustomId('server_name').setLabel('Server Name').setStyle(TextInputStyle.Short)
    .setRequired(false).setMaxLength(60).setValue(current.serverName || '');
  const instagram = new TextInputBuilder()
    .setCustomId('instagram').setLabel('Instagram').setStyle(TextInputStyle.Short)
    .setRequired(false).setMaxLength(60).setPlaceholder('@yourhandle').setValue(current.instagram || '');
  const discordHandle = new TextInputBuilder()
    .setCustomId('discord_handle').setLabel('Discord').setStyle(TextInputStyle.Short)
    .setRequired(false).setMaxLength(100).setPlaceholder('discord.gg/invite').setValue(current.discord || '');
  const youtube = new TextInputBuilder()
    .setCustomId('youtube').setLabel('YouTube').setStyle(TextInputStyle.Short)
    .setRequired(false).setMaxLength(60).setPlaceholder('@yourchannel').setValue(current.youtube || '');

  modal.addComponents(row(serverName), row(instagram), row(discordHandle), row(youtube));
  return modal;
}

function buildConfirmRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('pt_confirm_post').setLabel('Finalize & Post').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('pt_confirm_retry').setLabel('Re-run AI').setEmoji('🔁').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('pt_confirm_cancel').setLabel('Cancel').setEmoji('❌').setStyle(ButtonStyle.Danger),
  );
}

// ---------------------------------------------------------------------
// Points calculation & table rendering
// ---------------------------------------------------------------------

function computePoints(rawRows, pointsSystem) {
  return rawRows
    .filter(r => r && r.team)
    .map(r => {
      const placement = Math.max(1, Math.round(Number(r.placement)) || 99);
      const kills = Math.max(0, Math.round(Number(r.kills)) || 0);
      const placementPts = pointsSystem.placementPoints[placement - 1] ?? 0;
      const points = kills * pointsSystem.killPoints + placementPts;
      return { team: String(r.team).slice(0, 40), placement, kills, points };
    })
    .sort((a, b) => b.points - a.points || a.placement - b.placement);
}

function buildPointTableEmbed(guild, store, rows) {
  const design = store.settings.ptDesign || {};
  const title = design.serverName ? `🏆 ${design.serverName} — Point Table` : `🏆 ${guild.name} — Point Table`;

  const nameWidth = Math.max(4, ...rows.map(r => r.team.length));
  const header = `${'#'.padEnd(3)}${'Team'.padEnd(nameWidth)}  Plc  Kills  Pts`;
  const lines = rows.map((r, i) =>
    `${String(i + 1).padEnd(3)}${r.team.padEnd(nameWidth)}  ${String(r.placement).padEnd(3)}  ${String(r.kills).padEnd(5)}  ${r.points}`
  );

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(0xFEE75C)
    .setDescription('```\n' + [header, ...lines].join('\n') + '\n```')
    .setTimestamp();

  const socials = [];
  if (design.instagram) socials.push(`📸 ${design.instagram}`);
  if (design.discord) socials.push(`💬 ${design.discord}`);
  if (design.youtube) socials.push(`▶️ ${design.youtube}`);
  if (socials.length) embed.setFooter({ text: socials.join('   •   ') });

  return embed;
}

// ---------------------------------------------------------------------
// AI screenshot reading (Groq vision — same free-tier API as ai-chat.js)
// ---------------------------------------------------------------------

async function analyzeScreenshots({ lobbyUrls, resultUrls, slotlist }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error: "No `GROQ_API_KEY` is set in the bot's environment — an admin needs to add one (free tier at https://console.groq.com/keys) before Point Table Maker can read screenshots.",
    };
  }

  // Vision-capable Groq model. Groq's multimodal lineup changes over time —
  // override with GROQ_VISION_MODEL in .env if this one is ever retired.
  const model = process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';

  const systemPrompt = `You analyze Battlegrounds Mobile India (BGMI) match screenshots for a Discord esports bot.
You'll be shown lobby screenshot(s) (team names / slot assignments) and result screenshot(s) (the final standings screen showing each team's placement and kill count). Cross-reference them to work out, for every team you can identify, its final placement (1 = winner / chicken dinner) and total kill count.
If a slot list is provided, prefer those exact team names when matching teams to slots.
Respond with ONLY a raw JSON array, no markdown fences, no commentary — e.g.:
[{"team":"Team Alpha","placement":1,"kills":7},{"team":"Team Bravo","placement":2,"kills":4}]
Give your best estimate for any value you can't read with full confidence rather than omitting that team.`;

  const content = [];
  if (slotlist) {
    content.push({ type: 'text', text: `Slot list / team names provided by the host (prefer these names when matching teams):\n${slotlist}` });
  }
  content.push({ type: 'text', text: 'Lobby screenshot(s):' });
  for (const url of lobbyUrls) content.push({ type: 'image_url', image_url: { url } });
  content.push({ type: 'text', text: 'Result screenshot(s):' });
  for (const url of resultUrls) content.push({ type: 'image_url', image_url: { url } });
  content.push({ type: 'text', text: 'Output ONLY the raw JSON array now.' });

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content },
        ],
        max_tokens: 2000,
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[pt-handlers] Groq API returned ${res.status}:`, body);
      return { ok: false, error: `The AI service returned an error (HTTP ${res.status}). Try again in a moment.` };
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) return { ok: false, error: 'The AI returned an empty response — try again.' };

    const cleaned = text.replace(/```json\s*|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      console.error('[pt-handlers] Failed to parse AI JSON:', cleaned);
      return { ok: false, error: "Couldn't make sense of the AI's response — try again, or with clearer screenshots." };
    }

    if (!Array.isArray(parsed) || !parsed.length) {
      return { ok: false, error: "The AI couldn't identify any teams in those screenshots — try clearer/more complete screenshots." };
    }

    return { ok: true, rows: parsed };
  } catch (err) {
    console.error('[pt-handlers] Failed to reach Groq API:', err);
    return { ok: false, error: 'Could not reach the AI service. Try again in a moment.' };
  }
}

// ---------------------------------------------------------------------
// /construct-pt — called by cmd-construct-pt.js once it has pulled the
// slotlist string + attachment URLs off the interaction's options. This
// interaction is expected to already be deferred (ephemeral) by the caller.
// ---------------------------------------------------------------------

async function runConstructPt(interaction, { slotlist, lobbyUrls, resultUrls }) {
  const store = getGuildStore(interaction.guildId);
  const pointsSystem = store.settings.pointsSystem || DEFAULT_POINTS_SYSTEM;

  const result = await analyzeScreenshots({ lobbyUrls, resultUrls, slotlist });
  if (!result.ok) {
    await interaction.editReply({ content: `❌ ${result.error}` });
    return;
  }

  const rows = computePoints(result.rows, pointsSystem);
  if (!rows.length) {
    await interaction.editReply({ content: "❌ Couldn't extract any valid team results from those screenshots — try clearer images." });
    return;
  }

  const key = sessionKey(interaction.guildId, interaction.user.id);
  sessions.set(key, { slotlist, lobbyUrls, resultUrls, rows });

  const embed = buildPointTableEmbed(interaction.guild, store, rows);
  await interaction.editReply({
    content: '📊 Preview — AI reads can misjudge a name or kill count, so double-check before finalizing.',
    embeds: [embed],
    components: [buildConfirmRow()],
  });

  // Safety net: an abandoned preview shouldn't sit clickable forever.
  setTimeout(() => {
    if (sessions.get(key)?.rows === rows) {
      sessions.delete(key);
      interaction.editReply({ content: '⌛ This preview expired.', embeds: [], components: [] }).catch(() => {});
    }
  }, 15 * 60 * 1000);
}

// ---------------------------------------------------------------------
// Interaction handlers
// ---------------------------------------------------------------------

async function handlePtButton(interaction) {
  if (!hasManageGuild(interaction)) {
    return interaction.reply({ content: '❌ You need the **Manage Server** permission to do that.', flags: MessageFlags.Ephemeral });
  }

  const store = getGuildStore(interaction.guildId);
  const id = interaction.customId;
  const key = sessionKey(interaction.guildId, interaction.user.id);

  if (id === 'pt_construct') {
    return interaction.reply({
      content: "📥 Run **`/construct-pt`** to upload your lobby + result screenshots directly — Discord only allows file uploads through a slash command's options, not through a button or form.",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (id === 'pt_set_points') {
    return interaction.showModal(buildPointsModal(store.settings.pointsSystem || DEFAULT_POINTS_SYSTEM));
  }

  if (id === 'pt_design') {
    return interaction.showModal(buildDesignModal(store.settings.ptDesign || {}));
  }

  if (id === 'pt_confirm_post') {
    const session = sessions.get(key);
    if (!session || !session.rows) {
      return interaction.reply({ content: '❌ This preview expired — run `/construct-pt` again.', flags: MessageFlags.Ephemeral });
    }
    sessions.delete(key);
    const embed = buildPointTableEmbed(interaction.guild, store, session.rows);
    await interaction.channel.send({ embeds: [embed] });
    return interaction.update({ content: '✅ Posted to the channel!', embeds: [], components: [] });
  }

  if (id === 'pt_confirm_cancel') {
    sessions.delete(key);
    return interaction.update({ content: '❌ Cancelled.', embeds: [], components: [] });
  }

  if (id === 'pt_confirm_retry') {
    const session = sessions.get(key);
    if (!session) {
      return interaction.reply({ content: '❌ This preview expired — run `/construct-pt` again.', flags: MessageFlags.Ephemeral });
    }
    await interaction.update({ content: '🤖 Re-running AI analysis...', embeds: [], components: [] });

    const pointsSystem = store.settings.pointsSystem || DEFAULT_POINTS_SYSTEM;
    const result = await analyzeScreenshots({
      lobbyUrls: session.lobbyUrls, resultUrls: session.resultUrls, slotlist: session.slotlist,
    });

    if (!result.ok) {
      sessions.delete(key);
      return interaction.editReply({ content: `❌ ${result.error}`, components: [] });
    }

    const rows = computePoints(result.rows, pointsSystem);
    if (!rows.length) {
      sessions.delete(key);
      return interaction.editReply({ content: "❌ Still couldn't extract valid team results — try clearer screenshots.", components: [] });
    }

    session.rows = rows;
    const embed = buildPointTableEmbed(interaction.guild, store, rows);
    return interaction.editReply({
      content: '📊 Updated preview — double-check before finalizing.',
      embeds: [embed],
      components: [buildConfirmRow()],
    });
  }
}

async function handlePtModalSubmit(interaction) {
  if (!hasManageGuild(interaction)) {
    return interaction.reply({ content: '❌ You need the **Manage Server** permission to do that.', flags: MessageFlags.Ephemeral });
  }

  const id = interaction.customId;

  if (id === 'pt_points_modal') {
    const killPoints = Number(interaction.fields.getTextInputValue('kill_points').trim());
    if (!Number.isFinite(killPoints)) {
      return interaction.reply({ content: '❌ Points per kill must be a number.', flags: MessageFlags.Ephemeral });
    }

    const placementPoints = interaction.fields.getTextInputValue('placement_points')
      .split(',').map(s => Number(s.trim()));
    if (!placementPoints.length || placementPoints.some(n => !Number.isFinite(n))) {
      return interaction.reply({
        content: '❌ Placement points must be a comma-separated list of numbers, e.g. `10,6,5,4,3,2,1,1,0,0`.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const store = getGuildStore(interaction.guildId);
    store.settings.pointsSystem = { killPoints, placementPoints };
    saveGuildStore(interaction.guildId, store);

    return interaction.reply({
      content: `✅ Points system saved — **${killPoints}** point(s) per kill, placement points: \`${placementPoints.join(', ')}\`.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (id === 'pt_design_modal') {
    const serverName = interaction.fields.getTextInputValue('server_name').trim();
    const instagram = interaction.fields.getTextInputValue('instagram').trim();
    const discordHandle = interaction.fields.getTextInputValue('discord_handle').trim();
    const youtube = interaction.fields.getTextInputValue('youtube').trim();

    const store = getGuildStore(interaction.guildId);
    store.settings.ptDesign = {
      serverName: serverName || undefined,
      instagram: instagram || undefined,
      discord: discordHandle || undefined,
      youtube: youtube || undefined,
    };
    saveGuildStore(interaction.guildId, store);

    return interaction.reply({ content: '✅ Point Table design saved.', flags: MessageFlags.Ephemeral });
  }
}

module.exports = {
  buildPtPanel, handlePtButton, handlePtModalSubmit, runConstructPt,
  hasManageGuild, DEFAULT_POINTS_SYSTEM,
};
