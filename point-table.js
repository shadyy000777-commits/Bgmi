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
 * Sanity-checks one match's readings: placements should be distinct
 * integers starting at 1, and every row should have both a placement and
 * a kill count. Returns human-readable descriptions of anything off, so
 * they can be surfaced to staff as "please double-check this" rather than
 * silently trusting a misread.
 */
function findMatchIssues(match, matchIndex) {
  const issues = [];
  const label = `Match ${matchIndex + 1}${match.map ? ` (${match.map})` : ''}`;
  const results = match.results || [];

  const nullRows = results.filter(r => r.placement == null || r.kills == null);
  if (nullRows.length) {
    const names = nullRows.map(r => r.teamName || '(unknown team)').join(', ');
    issues.push(`${label}: couldn't clearly read placement/kills for ${names} — verify manually.`);
  }

  const placements = results.map(r => r.placement).filter(p => p != null);
  const seen = new Set();
  const duplicates = new Set();
  for (const p of placements) {
    if (seen.has(p)) duplicates.add(p);
    seen.add(p);
  }
  if (duplicates.size) {
    issues.push(`${label}: placement ${[...duplicates].join(', ')} appears more than once — likely a misread.`);
  }
  if (placements.length && !placements.includes(1)) {
    issues.push(`${label}: no team was read as placement #1 (WWCD) — double-check the winner.`);
  }

  return issues;
}

/**
 * @param {Array<{map: string|null, results: Array<{placement:number|null, teamName:string, kills:number|null}>}>} matches
 * @param {{killPoints:number, placements: Record<string,number>}} pointsSystem
 * @param {Array<{slot:number|null, teamName:string}>} roster
 * @returns {{rows: Array<object>, issues: string[]}}
 */
function calculatePointTable(matches, pointsSystem, roster) {
  const totals = new Map();
  const issues = [];

  // Seed every registered team first, at 0/0/0 — a team that never shows
  // up in a result screenshot (eliminated early, screenshot missed, etc.)
  // should still appear on the table at the bottom, not vanish entirely.
  for (const t of roster || []) {
    const key = normalizeName(t.teamName) || t.teamName;
    if (key && !totals.has(key)) {
      totals.set(key, { teamName: t.teamName, matchesPlayed: 0, wins: 0, kills: 0, placementPoints: 0, totalPoints: 0 });
    }
  }

  matches.forEach((match, matchIndex) => {
    issues.push(...findMatchIssues(match, matchIndex));

    for (const row of match.results || []) {
      const resolvedName = resolveTeamName(row.teamName, roster);
      const key = normalizeName(resolvedName) || resolvedName;
      if (!totals.has(key)) {
        totals.set(key, { teamName: resolvedName, matchesPlayed: 0, wins: 0, kills: 0, placementPoints: 0, totalPoints: 0 });
      }
      const entry = totals.get(key);
      // A row the AI flagged as illegible (null) contributes nothing to
      // points rather than being silently treated as 0 — 0 kills/last
      // place would understate a team that actually did fine, whereas
      // "contributes nothing yet" plus the issue note above tells staff
      // exactly what to go fix.
      const kills = row.kills == null ? 0 : Number(row.kills) || 0;
      const placementPts = row.placement == null ? 0 : (pointsSystem.placements[String(row.placement)] ?? 0);

      entry.matchesPlayed += 1;
      entry.wins += row.placement === 1 ? 1 : 0;
      entry.kills += kills;
      entry.placementPoints += placementPts;
      entry.totalPoints += placementPts + kills * pointsSystem.killPoints;
    }
  });

  const rows = [...totals.values()].sort((a, b) => b.totalPoints - a.totalPoints || b.kills - a.kills);
  return { rows, issues };
}

module.exports = {
  buildPointTablePanel,
  parseSlotlistText,
  resolveTeamName,
  calculatePointTable,
  findMatchIssues,
  normalizeName,
};
