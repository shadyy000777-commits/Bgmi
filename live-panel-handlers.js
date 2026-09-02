const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');
const { activeGroupLetters, groupDisplayName, slotRangeForGroup, resolveGroupSchedule } = require('./group-schedule');

// Each group gets its own embed field (rather than one giant description),
// since fields have their own 1024-char cap and Discord allows 25 of them
// per embed — so one page comfortably shows 25 groups (500 slots) without
// ever risking the description's 4096-char ceiling.
const GROUPS_PER_PAGE = 25;

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

function buildLiveGroupsPanel(store, page = 0) {
  const scrim = store.scrim;
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTimestamp();

  if (!scrim) {
    embed.setTitle('<a:emoji_14:1544290922043543552> Slot Availability').setDescription('No scrim is set up yet — run `!scrims` first.');
    return { embed, page: 0, totalPages: 1 };
  }

  embed.setTitle(`<a:emoji_14:1544290922043543552> ${scrim.scrimName} — Slot Availability`);

  const letters = activeGroupLetters(scrim.totalSlots);
  if (!letters.length) {
    embed.setDescription('No groups yet — increase the scrim\'s total slots to open Group 1.');
    return { embed, page: 0, totalPages: 1 };
  }

  const totalPages = Math.max(1, Math.ceil(letters.length / GROUPS_PER_PAGE));
  const clampedPage = Math.min(Math.max(page, 0), totalPages - 1);
  const pageLetters = letters.slice(clampedPage * GROUPS_PER_PAGE, (clampedPage + 1) * GROUPS_PER_PAGE);

  for (const letter of pageLetters) {
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

    embed.addFields({
      name: `${fillCircle(filled, capacity)} ${groupDisplayName(letter)}${dateLabel}`,
      value: `🕐 ${scheduleLine}\n${dotsBar(filled, capacity)} ${filled}/${capacity} filled`,
    });
  }

  embed.setFooter({
    text: totalPages > 1
      ? `${scrim.open ? 'Registration OPEN' : 'Registration CLOSED'} • Page ${clampedPage + 1}/${totalPages}`
      : (scrim.open ? 'Registration OPEN — updates live as teams register' : 'Registration CLOSED'),
  });

  return { embed, page: clampedPage, totalPages };
}

// Prev/Next row for the live panel. Returns [] on a single page so small
// scrims show no buttons at all.
function buildLivePanelNavRow(page, totalPages) {
  if (totalPages <= 1) return [];
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`live_panel_page_${page - 1}`)
      .setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`live_panel_page_${page + 1}`)
      .setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1),
  )];
}

// Re-renders and edits the standing live panel message, if one has been
// posted via !live_panel. Safe to call after every registration change —
// silently does nothing if no panel is set up, and clears the stored
// reference if the message/channel was deleted. Stays on whichever page
// was last viewed rather than resetting to page 1 on every registration.
async function refreshLivePanel(client, guildId) {
  const store = getGuildStore(guildId);
  const channelId = store.settings && store.settings.livePanelChannelId;
  const messageId = store.settings && store.settings.livePanelMessageId;
  if (!channelId || !messageId) return;

  try {
    const channel = await client.channels.fetch(channelId);
    const message = await channel.messages.fetch(messageId);
    const currentPage = (store.settings && store.settings.livePanelPage) || 0;
    const { embed, page, totalPages } = buildLiveGroupsPanel(store, currentPage);
    await message.edit({ embeds: [embed], components: buildLivePanelNavRow(page, totalPages) });
  } catch (err) {
    // Message or channel is gone — stop trying to refresh it every time.
    console.error('Failed to refresh live panel (clearing it):', err.message);
    store.settings.livePanelChannelId = null;
    store.settings.livePanelMessageId = null;
    saveGuildStore(guildId, store);
  }
}

// Handles the Prev/Next buttons on the live panel itself.
async function handleLivePanelPageButton(interaction) {
  const store = getGuildStore(interaction.guildId);
  const requestedPage = parseInt(interaction.customId.replace('live_panel_page_', ''), 10) || 0;
  const { embed, page, totalPages } = buildLiveGroupsPanel(store, requestedPage);

  if (!store.settings) store.settings = {};
  store.settings.livePanelPage = page;
  saveGuildStore(interaction.guildId, store);

  await interaction.update({ embeds: [embed], components: buildLivePanelNavRow(page, totalPages) });
}

module.exports = { buildLiveGroupsPanel, buildLivePanelNavRow, refreshLivePanel, handleLivePanelPageButton };
