const { EmbedBuilder } = require('discord.js');

// Discord embeds cap at 25 fields, and each field here covers 20 slots —
// so one page tops out at 500 slots. Large scrims (thousands of slots)
// need multiple pages; callers page through with Prev/Next buttons.
const FIELD_CHUNK_SIZE = 20;
const SLOTS_PER_PAGE = FIELD_CHUNK_SIZE * 25;

function buildSlotListEmbed(scrim, page = 0) {
  const totalPages = Math.max(1, Math.ceil(scrim.totalSlots / SLOTS_PER_PAGE));
  const clampedPage = Math.min(Math.max(page, 0), totalPages - 1);

  const embed = new EmbedBuilder()
    .setTitle(`<a:emoji_14:1544290922043543552> ${scrim.scrimName || 'BGMI Scrim'} — Slot List`)
    .setColor(scrim.open ? 0x57F287 : 0xED4245)
    .setFooter({
      text: totalPages > 1
        ? `Registration ${scrim.open ? 'OPEN' : 'CLOSED'} • Page ${clampedPage + 1}/${totalPages}`
        : `Registration ${scrim.open ? 'OPEN' : 'CLOSED'}`,
    });

  const filled = Object.keys(scrim.slots).length;
  embed.setDescription(`Slots filled: **${filled}/${scrim.totalSlots}**`);

  const rangeStart = clampedPage * SLOTS_PER_PAGE + 1;
  const rangeEnd = Math.min(rangeStart + SLOTS_PER_PAGE - 1, scrim.totalSlots);

  for (let chunkStart = rangeStart; chunkStart <= rangeEnd; chunkStart += FIELD_CHUNK_SIZE) {
    const chunkEnd = Math.min(chunkStart + FIELD_CHUNK_SIZE - 1, rangeEnd);
    const lines = [];
    for (let i = chunkStart; i <= chunkEnd; i++) {
      const s = scrim.slots[i];
      lines.push(s ? `**Slot ${i}:** ${s.team}` : `**Slot ${i}:** _empty_`);
    }
    embed.addFields({ name: `${chunkStart}-${chunkEnd}`, value: lines.join('\n') });
  }

  return { embed, page: clampedPage, totalPages };
}

function buildGroupsEmbed(tournament) {
  const embed = new EmbedBuilder()
    .setTitle(`🥇 ${tournament.name || 'Tournament'} — Groups`)
    .setColor(tournament.open ? 0x57F287 : 0xED4245)
    .setFooter({ text: tournament.open ? 'Registration OPEN' : 'Registration CLOSED' });

  for (const [groupName, group] of Object.entries(tournament.groups)) {
    const lines = group.teams.length
      ? group.teams.map((t, idx) => `${idx + 1}. **${t.team}** — ${t.players.join(', ')}`)
      : ['_no teams yet_'];
    embed.addFields({
      name: `Group ${groupName} (${group.teams.length}/${group.capacity})`,
      value: lines.join('\n'),
    });
  }

  if (tournament.qualified.length) {
    embed.addFields({
      name: '✅ Qualified',
      value: tournament.qualified.map(t => `**${t}**`).join(', '),
    });
  }

  return embed;
}

module.exports = { buildSlotListEmbed, buildGroupsEmbed };
