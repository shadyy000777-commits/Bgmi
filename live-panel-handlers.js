const { EmbedBuilder } = require('discord.js');
const { getGuildStore, saveGuildStore, listGuildIds } = require('./storage');
const {
  groupDisplayName, slotRangeForGroup, getSchedule,
  currentDayBatchIndex, hasNextDayBatch, nextDayBatchIndex, lettersForDayBatch, dayLabelForBatch,
} = require('./group-schedule');

function fillCircle(filled, capacity) {
  if (capacity <= 0) return '⚪';
  const pct = filled / capacity;
  if (pct >= 1) return '🔴';
  if (pct >= 0.9) return '🟡';
  return '🟢';
}

function dotsBar(filled, capacity) {
  const shown = Math.min(capacity, 20); // keep the bar a sane width even for larger groups
  const filledDots = Math.round((filled / capacity) * shown);
  return '●'.repeat(filledDots) + '○'.repeat(Math.max(0, shown - filledDots));
}

// Registration is open 24/7 and groups keep filling forever, but the live
// panel only ever shows ONE day-batch of (up to 4) groups at a time — e.g.
// Groups 1-4 first. It keeps showing that batch, even as slots fill in,
// until every group in it is completely full, then flips over to the next
// batch (Groups 5-8), and so on. It never jumps ahead to a batch further
// out than the very next one, so people always see exactly what's open for
// registration right now — not a preview of the whole future schedule.
function buildLiveGroupsPanel(store) {
  const scrim = store.scrim;
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTimestamp();

  if (!scrim) {
    embed.setTitle('<a:emoji_14:1544290922043543552> Slot Availability').setDescription('No scrim is set up yet.');
    return embed;
  }

  embed.setTitle(`<a:emoji_14:1544290922043543552> ${scrim.scrimName} — Next Match Day`);

  if (!hasNextDayBatch(scrim)) {
    embed.setDescription('🎉 No upcoming match day scheduled yet — raise total slots (Edit) to open more groups.');
    embed.setFooter({ text: 'Registration OPEN 24/7' });
    return embed;
  }

  const batch = nextDayBatchIndex(scrim);
  const letters = lettersForDayBatch(scrim.totalSlots, batch);
  const { relative, dateLabel } = dayLabelForBatch(scrim, batch);

  embed.setDescription(`📅 **${relative}, ${dateLabel}**\nRegistration never closes — keep registering, the next day's groups open automatically as these fill.`);

  for (const letter of letters) {
    const { start, end } = slotRangeForGroup(letter, scrim.totalSlots);
    const capacity = end - start + 1;
    let filled = 0;
    for (let i = start; i <= end; i++) if (scrim.slots[i]) filled++;

    const schedule = getSchedule(store, letter);
    const scheduleLine = schedule
      ? 'IDP: ' + schedule.matches.map((m, i) => `M${i + 1}: ${m.idp} PM`).join(' | ')
      : 'IDP: not set — use `!group_schedule` to add match times';

    embed.addFields({
      name: `${fillCircle(filled, capacity)} ${groupDisplayName(letter)}`,
      value: `🕐 ${scheduleLine}\n${dotsBar(filled, capacity)} ${filled}/${capacity} filled`,
    });
  }

  embed.setFooter({ text: 'Registration OPEN 24/7 — updates live as teams register' });
  return embed;
}

// Re-renders and edits the standing live panel message, if one has been
// posted via !live_panel. Safe to call after every registration change,
// after a new day rolls over, and after schedule edits — silently does
// nothing if no panel is set up, and clears the stored reference if the
// message/channel was deleted.
async function refreshLivePanel(client, guildId) {
  const store = getGuildStore(guildId);
  const channelId = store.settings && store.settings.livePanelChannelId;
  const messageId = store.settings && store.settings.livePanelMessageId;
  if (!channelId || !messageId) return;

  try {
    const channel = await client.channels.fetch(channelId);
    const message = await channel.messages.fetch(messageId);
    await message.edit({ embeds: [buildLiveGroupsPanel(store)], components: [] });
  } catch (err) {
    // Message or channel is gone — stop trying to refresh it every time.
    console.error('Failed to refresh live panel (clearing it):', err.message);
    store.settings.livePanelChannelId = null;
    store.settings.livePanelMessageId = null;
    saveGuildStore(guildId, store);
  }
}

module.exports = { buildLiveGroupsPanel, refreshLivePanel, startLivePanelDayRollover };

// Registration is 24/7 with no admin action required to advance to the next
// day's groups, so nothing else naturally triggers a panel refresh right at
// midnight IST if nobody happens to register at that exact moment. This
// polls every few minutes and re-renders any configured live panel so it
// flips over to the new day's batch on its own.
function startLivePanelDayRollover(client, intervalMs = 5 * 60 * 1000) {
  setInterval(async () => {
    for (const guildId of listGuildIds()) {
      const store = getGuildStore(guildId);
      if (store.settings && store.settings.livePanelChannelId && store.settings.livePanelMessageId) {
        await refreshLivePanel(client, guildId);
      }
    }
  }, intervalMs);
}
