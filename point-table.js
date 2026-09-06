const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// ---------- Panel (posted by !pt) ----------

function buildPointTablePanel(store) {
  const embed = new EmbedBuilder()
    .setTitle('📊 Point Table Maker  •  BETA')
    .setColor(0x5865F2)
    .setDescription('Automatically generate ranked BGMI match point tables using AI.')
    .addFields(
      { name: '➕ Construct PT', value: 'Upload lobby & result screenshots; AI draws the PT.' },
      { name: '⚙️ Set Points System', value: 'Configure kill & placement points for this server.' },
      { name: '🖌️ Design PT', value: 'Add server name, Instagram, Discord & YouTube handles.' },
    )
    .setFooter({ text: "Beta feature — results may have bugs. AI reads your screenshots, so double-check before you post the final table." });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('pt_construct').setLabel('Construct PT').setEmoji('➕').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('pt_set_points').setLabel('Set Points System').setEmoji('⚙️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('pt_design').setLabel('Design PT').setEmoji('🖌️').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row] };
}

// ---------- Slotlist parsing (used when the user pastes a slotlist instead of relying on lobby screenshots) ----------

// Matches lines like "1. Team Name @user1 @user2" — captures the number and
// the team name, discarding any trailing @mentions.
const SLOTLIST_LINE_RE = /^\s*(\d+)[\.\)]\s*(.+)$/;

function parseSlotlistText(text) {
  const teams = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(SLOTLIST_LINE_RE);
    if (!match) continue;
    const slot = parseInt(match[1], 10);
    const teamName = match[2].replace(/<@!?\d+>/g, '').trim();
    if (teamName) teams.push({ slot, teamName });
  }
  return teams;
}

// ---------- Name matching (OCR'd result names -> known roster) ----------

function normalizeName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Finds the roster entry a result-screen name most likely refers to.
// Exact normalized match first, then a loose contains-either-way match
// (handles OCR dropping a clan tag or punctuation). Falls back to the raw
// OCR'd name if nothing in the roster is close, so the team still shows up
// in the table instead of silently vanishing.
function resolveTeamName(ocrName, roster) {
  const normalized = normalizeName(ocrName);
  if (!normalized) return ocrName;

  const exact = roster.find(t => normalizeName(t.teamName) === normalized);
  if (exact) return exact.teamName;

  const loose = roster.find(t => {
    const rn = normalizeName(t.teamName);
    return rn && (rn.includes(normalized) || normalized.includes(rn));
  });
  if (loose) return loose.teamName;

  return ocrName;
}

// ---------- Scoring ----------

/**
 * @param {Array<{map: string|null, results: Array<{placement:number, teamName:string, kills:number}>}>} matches
 * @param {{killPoints:number, placements: Record<string,number>}} pointsSystem
 * @param {Array<{slot:number|null, teamName:string}>} roster
 * @returns {Array<{teamName:string, matchesPlayed:number, wins:number, kills:number, placementPoints:number, totalPoints:number}>}
 */
function calculatePointTable(matches, pointsSystem, roster) {
  const totals = new Map();

  for (const match of matches) {
    for (const row of match.results || []) {
      const resolvedName = resolveTeamName(row.teamName, roster);
      const key = normalizeName(resolvedName) || resolvedName;
      if (!totals.has(key)) {
        totals.set(key, { teamName: resolvedName, matchesPlayed: 0, wins: 0, kills: 0, placementPoints: 0, totalPoints: 0 });
      }
      const entry = totals.get(key);
      const kills = Number(row.kills) || 0;
      const placementPts = pointsSystem.placements[String(row.placement)] ?? 0;

      entry.matchesPlayed += 1;
      entry.wins += row.placement === 1 ? 1 : 0;
      entry.kills += kills;
      entry.placementPoints += placementPts;
      entry.totalPoints += placementPts + kills * pointsSystem.killPoints;
    }
  }

  return [...totals.values()].sort((a, b) => b.totalPoints - a.totalPoints || b.kills - a.kills);
}

function buildPointTableResultEmbed(rows, matches, design, scrimName) {
  const title = design?.serverName ? `🏆 ${design.serverName} — Point Table` : `🏆 ${scrimName || 'BGMI Scrim'} — Point Table`;

  const header = ' # | Team                       | WWCD | Kills | Pts';
  const divider = '---+----------------------------+------+-------+-----';
  const lines = [header, divider];

  rows.slice(0, 25).forEach((r, i) => {
    const rank = String(i + 1).padStart(2, ' ');
    const name = r.teamName.length > 26 ? r.teamName.slice(0, 25) + '…' : r.teamName.padEnd(26, ' ');
    const wwcd = String(r.wins).padStart(4, ' ');
    const kills = String(r.kills).padStart(5, ' ');
    const pts = String(r.totalPoints).padStart(4, ' ');
    lines.push(`${rank} | ${name} | ${wwcd} | ${kills} | ${pts}`);
  });

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(0xF1C40F)
    .setDescription('```\n' + lines.join('\n') + '\n```')
    .addFields({ name: 'Matches read', value: String(matches.length), inline: true }, { name: 'Teams ranked', value: String(rows.length), inline: true });

  if (rows.length > 25) {
    embed.setDescription(embed.data.description + `\n_+${rows.length - 25} more team(s) not shown._`);
  }

  const brandLines = [];
  if (design?.instagram) brandLines.push(`📸 Instagram: ${design.instagram}`);
  if (design?.discordInvite) brandLines.push(`💬 Discord: ${design.discordInvite}`);
  if (design?.youtube) brandLines.push(`▶️ YouTube: ${design.youtube}`);
  if (brandLines.length) embed.addFields({ name: 'Follow us', value: brandLines.join('\n') });

  embed.setFooter({ text: 'Generated by AI from uploaded screenshots — please double-check kills/placements before treating this as final.' });

  return embed;
}

module.exports = {
  buildPointTablePanel,
  parseSlotlistText,
  resolveTeamName,
  calculatePointTable,
  buildPointTableResultEmbed,
};
