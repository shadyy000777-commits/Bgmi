const { EmbedBuilder } = require('discord.js');

function buildSlotListEmbed(scrim) {
  const embed = new EmbedBuilder()
    .setTitle(`<a:emoji_14:1544290922043543552> ${scrim.scrimName || 'BGMI Scrim'} — Slot List`)
    .setColor(scrim.open ? 0x57F287 : 0xED4245)
    .setFooter({ text: scrim.open ? 'Registration OPEN' : 'Registration CLOSED' });

  const filled = Object.keys(scrim.slots).length;
  embed.setDescription(`Slots filled: **${filled}/${scrim.totalSlots}**`);

  const lines = [];
  for (let i = 1; i <= scrim.totalSlots; i++) {
    const s = scrim.slots[i];
    lines.push(s ? `**Slot ${i}:** ${s.team}` : `**Slot ${i}:** _empty_`);
  }

  const chunkSize = 20;
  for (let i = 0; i < lines.length; i += chunkSize) {
    const chunk = lines.slice(i, i + chunkSize).join('\n');
    embed.addFields({ name: `${i + 1}-${Math.min(i + chunkSize, lines.length)}`, value: chunk });
  }

  return embed;
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
