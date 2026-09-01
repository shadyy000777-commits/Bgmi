const { EmbedBuilder } = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');
const { activeGroupLetters, groupDisplayName, slotRangeForGroup, resolveGroupSchedule } = require('./group-schedule');

function fillCircle(filled, capacity) {
  if (capacity <= 0) return '⚪';
  const pct = filled / capacity;
  if (pct >= 0.9) return '🟡';
  if (pct >= 1) return '🔴';
  return '🟢';
}

function dotsBar(filled, capacity) {
  const shown = Math.min(capacity, 20); // keep the bar a sane width even for larger groups
  const filledDots = Math.round((filled / capacity) * shown);
  return '●'.repeat(filledDots) + '○'.repeat(Math.max(0, shown - filledDots));
}

function buildLiveGroupsPanel(store) {
  const scrim = store.scrim;
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTimestamp();

  if (!scrim) {
    embed.setTitle('🏆 Slot Availability').setDescription('No scrim is set up yet — run `!scrims` first.');
    return embed;
  }

  embed.setTitle(`🏆 ${scrim.scrimName} — Slot Availability`);

  const letters = activeGroupLetters(scrim.totalSlots);
  if (!letters.length) {
    embed.setDescription('No groups yet — increase the scrim\'s total slots to open Group 1.');
    return embed;
  }

  const lines = letters.map(letter => {
    const { start, end } = slotRangeForGroup(letter, scrim.totalSlots);
    const capacity = end - start + 1;
    let filled = 0;
    for (let i = start; i <= end; i++) if (scrim.slots[i]) filled++;

    const resolved = resolveGroupSchedule(letter, store);
    let scheduleLine = 'IDP: not set — use `!group_schedule` to add match times';
    let dateLabel = '';
    if (resolved) {
      dateLabel = ` — ${resolved.isToday ? 'Today' : 'Tomorrow'}`;
      const idpTimes = resolved.schedule.matches.map((m, i) => `M${i + 1}: ${m.idp} PM`).join(' | ');
      scheduleLine = `IDP: ${idpTimes}`;
    }

    return (
      `${fillCircle(filled, capacity)} **${groupDisplayName(letter)}${dateLabel}**\n` +
      `🕐 ${scheduleLine}\n` +
      `${dotsBar(filled, capacity)} ${filled}/${capacity} filled`
    );
  });

  // Discord embed description caps at 4096 chars — comfortably fits well
  // beyond the 12-group (A-L) maximum this bot supports.
  embed.setDescription(lines.join('\n\n'));
  embed.setFooter({ text: scrim.open ? 'Registration OPEN — updates live as teams register' : 'Registration CLOSED' });

  return embed;
}

// Re-renders and edits the standing live panel message, if one has been
// posted via !live_panel. Safe to call after every registration change —
// silently does nothing if no panel is set up, and clears the stored
// reference if the message/channel was deleted.
async function refreshLivePanel(client, guildId) {
  const store = getGuildStore(guildId);
  const channelId = store.settings && store.settings.livePanelChannelId;
  const messageId = store.settings && store.settings.livePanelMessageId;
  if (!channelId || !messageId) return;

  try {
    const channel = await client.channels.fetch(channelId);
    const message = await channel.messages.fetch(messageId);
    await message.edit({ embeds: [buildLiveGroupsPanel(store)] });
  } catch (err) {
    // Message or channel is gone — stop trying to refresh it every time.
    console.error('Failed to refresh live panel (clearing it):', err.message);
    store.settings.livePanelChannelId = null;
    store.settings.livePanelMessageId = null;
    saveGuildStore(guildId, store);
  }
}

module.exports = { buildLiveGroupsPanel, refreshLivePanel };
