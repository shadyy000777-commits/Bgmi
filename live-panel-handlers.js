const { EmbedBuilder } = require('discord.js');
const { getGuildStore, saveGuildStore, listGuildIds } = require('./storage');
const {
  groupDisplayName, slotRangeForGroup, localSlotNumber, getSchedule, matchScheduleLines,
  nextOpenGroupLetters, dayBatchForLetter, dayLabelForBatch, isGroupClosed,
  formatDDMMYYYY,
} = require('./group-schedule');
const { buildGroupAdminPanelRows } = require('./group-admin-panel');

function fillCircle(filled, capacity) {
  if (capacity <= 0) return '⚪';
  const pct = filled / capacity;
  if (pct >= 1) return '<a:emoji_198:1546394323996909610>';
  if (pct >= 0.9) return '<a:emoji_199:1546397349910417428>';
  return '<a:emoji_197:1546394268166262835>';
}

function dotsBar(filled, capacity) {
  const shown = Math.min(capacity, 20); // keep the bar a sane width even for larger groups
  const filledDots = Math.round((filled / capacity) * shown);
  return '●'.repeat(filledDots) + '○'.repeat(Math.max(0, shown - filledDots));
}

// Registration is open 24/7 and groups keep filling forever, but the live
// panel only ever shows a rolling window of (up to) 4 groups at a time. It
// is a straightforward "next 4 open groups" list, not a batch that has to
// completely fill before advancing: as soon as a group's result is posted
// (closed), it drops off the front of the window and the next group slides
// in to take its place. So Group 1's result posted flips the display from
// 1,2,3,4 straight to 2,3,4,5 — it doesn't wait for 2, 3, and 4 to fill up
// too, and it doesn't wait for a whole calendar day's groups to finish.
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

  const letters = nextOpenGroupLetters(store);
  if (!letters.length) {
    embed.setDescription('🎉 No upcoming groups left — raise total slots (Edit) to open more.');
    embed.setFooter({ text: 'Registration OPEN 24/7' });
    return embed;
  }

  // The window can span more than one calendar day once earlier groups
  // close out of step with later ones filling — use whichever day the
  // FIRST group shown belongs to for the header label; it's just a
  // heads-up date, not something registration logic depends on.
  const { relative, dateLabel } = dayLabelForBatch(scrim, dayBatchForLetter(letters[0]));

  embed.setDescription(`🗓 **${relative}, ${dateLabel}**\nRegistration never closes — keep registering.`);

  for (const letter of letters) {
    const { start, end } = slotRangeForGroup(letter, scrim.totalSlots);
    const capacity = end - start + 1;
    let filled = 0;
    for (let i = start; i <= end; i++) if (scrim.slots[i]) filled++;

    const schedule = getSchedule(store, letter);
    const scheduleLine = schedule
      ? 'IDP: ' + schedule.matches.map((m, i) => `M${i + 1}: ${m.idp} PM`).join(' | ')
      : 'IDP: not set — use `!group_schedule` to add match times';

    const groupDate = formatDDMMYYYY(dayLabelForBatch(scrim, dayBatchForLetter(letter)).dayNumber);

    embed.addFields({
      name: `${fillCircle(filled, capacity)} ${groupDisplayName(letter)} (${groupDate})`,
      value: `🕐 ${scheduleLine}\n${dotsBar(filled, capacity)} ${filled}/${capacity} filled`,
    });
  }

  embed.setFooter({ text: 'Registration OPEN 24/7 — updates live as teams register' });
  return embed;
}

// Every group's own auto-created channel (see giveGroupChannel in
// register-handlers.js) gets two standing messages showing that group's
// state — Group 1's channel only ever shows Group 1's info, Group 2's
// channel only Group 2's, etc:
//   1. A header embed — title, fill count, and match schedule (the summary
//      part people check at a glance).
//   2. A roster embed — the actual numbered slot list: which team (or
//      "empty") is in each slot.
// These used to be one combined embed; they're kept as two separate
// messages so the summary and the full roster can be read (and scrolled
// past) independently.
// Once a group is closed (its result was posted), its scrim.slots get
// cleared so registration can move on — but the slot list shouldn't go
// blank because of that. clearGroupRegistrations (group-admin-handlers.js)
// snapshots the roster into settings.groupFinalRosters right before
// clearing it; these two embeds read from that frozen copy for any closed
// group instead of the (now-empty) live slots, so the last-published slot
// list keeps showing who actually played. Falls back to live scrim.slots
// for open groups, and for older closed groups from before this existed.
function frozenRosterFor(store, groupLetter) {
  const scrim = store.scrim;
  if (!isGroupClosed(scrim, groupLetter)) return null;
  return (store.settings.groupFinalRosters && store.settings.groupFinalRosters[groupLetter]) || null;
}

function buildGroupHeaderEmbed(store, groupLetter) {
  const scrim = store.scrim;
  const { start, end } = slotRangeForGroup(groupLetter, scrim.totalSlots);
  const capacity = end - start + 1;

  const frozenRoster = frozenRosterFor(store, groupLetter);

  let filled = 0;
  if (frozenRoster) {
    filled = Object.keys(frozenRoster).length;
  } else {
    for (let i = start; i <= end; i++) if (scrim.slots[i]) filled++;
  }

  return new EmbedBuilder()
    .setTitle(`<a:emoji_14:1544290922043543552> ${groupDisplayName(groupLetter)} — Slot List`)
    .setColor(0x57F287)
    .setDescription(`Slots filled: **${filled}/${capacity}**\n${matchScheduleLines(groupLetter, store)}`)
    .setFooter({ text: frozenRoster ? '<:emoji_191:1545549860592156753> Result posted — this slot list is now frozen' : 'Updates live as teams register into this group' })
    .setTimestamp();
}

async function buildGroupRosterEmbed(store, groupLetter, guild) {
  const scrim = store.scrim;
  const { start, end } = slotRangeForGroup(groupLetter, scrim.totalSlots);

  const frozenRoster = frozenRosterFor(store, groupLetter);

  // Monospace table: Slot | Team | Owner. Owner shows the actual Discord
  // *username* of whoever registered the team (looked up live from their
  // userId) — plain text, not a mention, since Discord doesn't render
  // real mentions inside a ``` code block anyway. Falls back to the
  // ownerName text typed at registration if the user can't be resolved
  // (e.g. they left the server since registering).
  // Columns kept tight enough to fit on one line on a phone screen — a
  // Discord mobile code block wraps well before 40 characters, which is
  // what caused a long username to spill onto its own line and break the
  // table before. This also keeps well under the 1024-char field cap.
  const colWidths = { slot: 4, team: 9, owner: 12 };
  const pad = (str, width) => {
    const s = String(str);
    return s.length > width ? s.slice(0, width - 1) + '…' : s.padEnd(width, ' ');
  };
  const trunc = (str, width) => {
    const s = String(str);
    return s.length > width ? s.slice(0, width - 1) + '…' : s;
  };

  const rows = [];
  rows.push(`${pad('Slot', colWidths.slot)}| ${pad('Team', colWidths.team)}| Owner`);
  rows.push('-'.repeat(colWidths.slot + colWidths.team + colWidths.owner + 4));

  // Collect the slots for this range once, then resolve all needed
  // usernames in parallel (guild.members.fetch per-slot in a sequential
  // loop would mean one network round trip after another for a full
  // 20-slot group).
  const slotsInRange = [];
  for (let i = start; i <= end; i++) slotsInRange.push(frozenRoster ? frozenRoster[i] : scrim.slots[i]);

  const usernameById = new Map();
  if (guild) {
    const userIds = [...new Set(slotsInRange.filter(s => s && s.userId).map(s => s.userId))];
    await Promise.all(userIds.map(async (userId) => {
      try {
        const member = await guild.members.fetch(userId);
        usernameById.set(userId, member.user.username);
      } catch (err) {
        // Left the server or fetch failed — falls back to ownerName below.
      }
    }));
  }

  slotsInRange.forEach((slot, idx) => {
    const i = start + idx;
    const num = String(localSlotNumber(i)).padStart(2, '0');
    const team = slot ? slot.team : '-';
    const owner = slot ? (usernameById.get(slot.userId) || slot.ownerName || 'Unknown') : '-';
    rows.push(`${pad(num, colWidths.slot)}| ${pad(team, colWidths.team)}| ${trunc(owner, colWidths.owner)}`);
  });

  return new EmbedBuilder()
    .setColor(0x57F287)
    .addFields({
      name: `Slots ${localSlotNumber(start)}-${localSlotNumber(end)}`,
      value: '```\n' + rows.join('\n') + '\n```',
    });
}

// Re-renders (or, the first time, posts) the standing HEADER message in a
// group's channel — the "Slots filled + schedule" summary plus the admin
// button panel. Call this any time that group's roster changes. This is
// deliberately the only thing that auto-posts/updates on its own; the
// actual roster (who's in which slot) stays hidden until an admin taps
// "Publish Slot List" — see publishGroupRoster below. Silently does
// nothing if that group doesn't have a channel yet.
async function refreshGroupSlotList(client, guildId, groupLetter) {
  const store = getGuildStore(guildId);
  if (!store.scrim) return;

  const channelId = store.settings && store.settings.groupChannels && store.settings.groupChannels[groupLetter];
  if (!channelId) return;

  if (!store.settings.groupSlotListMessageIds) store.settings.groupSlotListMessageIds = {};
  if (!store.settings.groupRosterMessageIds) store.settings.groupRosterMessageIds = {};

  try {
    const channel = await client.channels.fetch(channelId);

    await upsertGroupMessage(channel, store, guildId, groupLetter, {
      idMap: store.settings.groupSlotListMessageIds,
      build: () => ({
        embeds: [buildGroupHeaderEmbed(store, groupLetter)],
        components: buildGroupAdminPanelRows(groupLetter),
      }),
    });

    // Once an admin has published the roster at least once, keep it live
    // — otherwise leave it untouched (and unposted) until they do.
    const published = store.settings.groupRosterPublished && store.settings.groupRosterPublished[groupLetter];
    if (published) {
      await upsertGroupMessage(channel, store, guildId, groupLetter, {
        idMap: store.settings.groupRosterMessageIds,
        build: async () => ({ embeds: [await buildGroupRosterEmbed(store, groupLetter, channel.guild)] }),
      });
    }
  } catch (err) {
    console.error(`Failed to refresh Group ${groupLetter}'s slot list in guild ${guildId}:`, err.message);
  }
}

// Posts (or, if already published, re-posts/edits) the actual roster —
// this is what "Publish Slot List" triggers. Marks the group as published
// so refreshGroupSlotList starts keeping the roster live from here on.
async function publishGroupRoster(client, guildId, groupLetter) {
  const store = getGuildStore(guildId);
  if (!store.scrim) return { error: '❌ No scrim is set up right now.' };

  const channelId = store.settings && store.settings.groupChannels && store.settings.groupChannels[groupLetter];
  if (!channelId) return { error: "❌ This group doesn't have a channel yet." };

  if (!store.settings.groupRosterMessageIds) store.settings.groupRosterMessageIds = {};
  if (!store.settings.groupRosterPublished) store.settings.groupRosterPublished = {};

  try {
    const channel = await client.channels.fetch(channelId);
    await upsertGroupMessage(channel, store, guildId, groupLetter, {
      idMap: store.settings.groupRosterMessageIds,
      build: async () => ({ embeds: [await buildGroupRosterEmbed(store, groupLetter, channel.guild)] }),
    });

    store.settings.groupRosterPublished[groupLetter] = true;
    saveGuildStore(guildId, store);
    return {};
  } catch (err) {
    console.error(`Failed to publish Group ${groupLetter}'s roster in guild ${guildId}:`, err.message);
    return { error: '❌ Something went wrong publishing the slot list — check the bot\'s permissions in this channel.' };
  }
}

// Shared edit-or-post logic for a single standing message tracked in one of
// the id maps above — edits it in place if it still exists, otherwise posts
// a fresh one and saves its id.
async function upsertGroupMessage(channel, store, guildId, groupLetter, { idMap, build }) {
  const messageId = idMap[groupLetter];

  if (messageId) {
    try {
      const message = await channel.messages.fetch(messageId);
      await message.edit(await build());
      return;
    } catch (err) {
      // The stored message is gone — fall through and post a fresh one.
    }
  }

  const sent = await channel.send(await build());
  idMap[groupLetter] = sent.id;
  saveGuildStore(guildId, store);
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

module.exports = {
  buildLiveGroupsPanel, refreshLivePanel, startLivePanelDayRollover,
  buildGroupHeaderEmbed, buildGroupRosterEmbed, refreshGroupSlotList, publishGroupRoster,
};

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
