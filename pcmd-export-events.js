const { AttachmentBuilder } = require('discord.js');
const { getGuildStore } = require('./storage');
const { groupLetterForSlot, groupDisplayName, localSlotNumber } = require('./group-schedule');

function csvValue(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers, rows) {
  return [headers, ...rows].map(r => r.map(csvValue).join(',')).join('\r\n');
}

module.exports = {
  name: 'export_events',
  aliases: ['exportevents'],
  description: 'Download all registrations as a CSV, in day/group order — usage: !export_events <scrim|tournament>',
  adminOnly: true,

  async execute(message, args) {
    const type = (args[0] || '').toLowerCase();
    if (type !== 'scrim' && type !== 'tournament') {
      return message.reply('❌ Usage: `!export_events scrim` or `!export_events tournament`').catch(() => {});
    }

    const store = getGuildStore(message.guildId);
    let csv, filename, rowCount;

    if (type === 'scrim') {
      const scrim = store.scrim;
      if (!scrim) {
        return message.reply('❌ No scrim is set up yet.').catch(() => {});
      }

      const headers = ['Group', 'Slot', 'Team', 'Owner', 'WhatsApp', 'Players', 'Registered At'];
      const rows = Object.entries(scrim.slots)
        .map(([slotNum, s]) => ({ ...s, slotNum: parseInt(slotNum, 10) }))
        // Sorting by the global slot number keeps rows in registration/group
        // order — since each group is a contiguous slot range, this is the
        // same as ordering "Group 1, then Group 2, ..." start to finish.
        .sort((a, b) => a.slotNum - b.slotNum)
        .map(s => [
          groupDisplayName(groupLetterForSlot(s.slotNum)),
          localSlotNumber(s.slotNum),
          s.team,
          s.ownerName || '',
          s.whatsapp || '',
          (s.players || []).join(' | '),
          s.registeredAt ? new Date(s.registeredAt).toISOString() : '',
        ]);

      csv = toCsv(headers, rows);
      filename = `scrim-${(scrim.scrimName || 'export').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`;
      rowCount = rows.length;
    } else {
      const tournament = store.tournament;
      if (!tournament) {
        return message.reply('❌ No tournament is set up yet.').catch(() => {});
      }

      const headers = ['Group', 'Team'];
      const rows = [];
      for (const [letter, group] of Object.entries(tournament.groups).sort(([a], [b]) => a.localeCompare(b))) {
        for (const t of group.teams) rows.push([groupDisplayName(letter), typeof t === 'string' ? t : t.team]);
      }

      csv = toCsv(headers, rows);
      filename = `tournament-${(tournament.name || 'export').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`;
      rowCount = rows.length;
    }

    const attachment = new AttachmentBuilder(Buffer.from(csv, 'utf8'), { name: filename });
    await message.channel.send({
      content: `📄 Exported **${rowCount}** registration(s).${rowCount === 0 ? ' (Nothing registered yet.)' : ''}`,
      files: [attachment],
    });
  },
};
