const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, UserSelectMenuBuilder,
} = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');
const { startPending, getPending, updatePending, clearPending } = require('./pending-team-registrations');
// Reusing the exact same modal builders /verify-panel uses, so "Register New
// Team" (and "Edit Team") present the identical form the player already knows.
const { buildVerifyStep1Modal, buildVerifyStep2Modal, buildVerifyStep3Modal } = require('./verification-modals');

const WHATSAPP_RE = /^\+?[0-9]{7,15}$/;
const UID_RE = /^[0-9]{5,12}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const P5_COMBINED_RE = /^(.+?)\s*-\s*([0-9]{5,12})$/;

const RESTART_HINT = 'Click **Register Team** again to restart — no partial data is saved.';

// Slots 1-5 are reserved and never assigned — the first team gets slot 6.
// From there, each group holds 20 teams (slot 6-25 = Group A, 26-45 = Group B, ...).
const FIRST_ASSIGNABLE_SLOT = 6;
const TEAMS_PER_GROUP = 20;

function groupLetterForSlot(slotNumber) {
  const index = Math.floor((slotNumber - FIRST_ASSIGNABLE_SLOT) / TEAMS_PER_GROUP);
  return String.fromCharCode(65 + index); // 0 -> 'A', 1 -> 'B', ...
}

// Fixed match schedule per group (Group A = image's "Group 1", B = "Group 2",
// etc.). Each group plays 2 matches. Update this table any time the schedule
// changes — nothing else in the code needs to change.
const GROUP_SCHEDULE = {
  A: { matches: [{ idp: '12:54', start: '01:00', map: 'Erangel' }, { idp: '01:34', start: '01:40', map: 'Miramar' }] },
  B: { matches: [{ idp: '01:04', start: '01:10', map: 'Rondo' }, { idp: '01:44', start: '01:50', map: 'Erangel' }] },
  C: { matches: [{ idp: '02:14', start: '02:20', map: 'Miramar' }, { idp: '02:54', start: '03:00', map: 'Rondo' }] },
  D: { matches: [{ idp: '02:44', start: '02:50', map: 'Erangel' }, { idp: '03:24', start: '03:30', map: 'Miramar' }] },
  E: { matches: [{ idp: '03:54', start: '04:00', map: 'Rondo' }, { idp: '04:34', start: '04:40', map: 'Erangel' }] },
  F: { matches: [{ idp: '04:54', start: '05:00', map: 'Miramar' }, { idp: '05:34', start: '05:40', map: 'Rondo' }] },
  G: { matches: [{ idp: '05:14', start: '05:20', map: 'Erangel' }, { idp: '05:54', start: '06:00', map: 'Miramar' }] },
  H: { matches: [{ idp: '07:14', start: '07:20', map: 'Rondo' }, { idp: '07:54', start: '08:00', map: 'Erangel' }] },
  I: { matches: [{ idp: '08:14', start: '08:20', map: 'Miramar' }, { idp: '08:54', start: '09:00', map: 'Rondo' }] },
  J: { matches: [{ idp: '08:44', start: '08:50', map: 'Erangel' }, { idp: '09:24', start: '09:30', map: 'Miramar' }] },
  K: { matches: [{ idp: '09:54', start: '10:00', map: 'Rondo' }, { idp: '10:34', start: '10:40', map: 'Erangel' }] },
  L: { matches: [{ idp: '10:54', start: '11:00', map: 'Miramar' }, { idp: '11:34', start: '11:40', map: 'Rondo' }] },
};

// All schedule times are 12-hour-clock without AM/PM, and this bot's scrims
// run in a single stretch from ~12:54 PM through ~11:40 PM daily — so hour
// 12 stays as noon (PM) and hours 1-11 are treated as PM (add 12).
function parseMatchMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const hour24 = h === 12 ? 12 : h + 12;
  return hour24 * 60 + m;
}

// Reads the current wall-clock date/time in India Standard Time specifically
// (not the server's local time zone), since this schedule is built around
// IST regardless of where the bot process actually runs.
function getISTParts() {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map(p => [p.type, p.value]));
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    // hour12:false can render midnight as "24" in some engines instead of "00"
    hour: parts.hour === '24' ? 0 : parseInt(parts.hour, 10),
    minute: parseInt(parts.minute, 10),
  };
}

function formatDateLabel(anchorMs) {
  return new Date(anchorMs).toLocaleDateString('en-US', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

function matchScheduleLines(group) {
  const schedule = GROUP_SCHEDULE[group];
  if (!schedule) {
    return "⏰ **Match Schedule** — not set yet for this group, check pinned messages or ask an admin.";
  }

  const { year, month, day, hour, minute } = getISTParts();
  const nowMinutes = hour * 60 + minute;
  // Used purely as calendar anchors (Y/M/D), not real moments in time — this
  // lets us format "today"/"tomorrow" in IST without extra timezone math.
  const todayAnchor = Date.UTC(year, month - 1, day);
  const tomorrowAnchor = todayAnchor + 24 * 60 * 60 * 1000;

  const upcoming = schedule.matches.filter(m => parseMatchMinutes(m.start) > nowMinutes);
  const isToday = upcoming.length > 0;
  // If every match today has already started/passed, show tomorrow's full schedule instead.
  const matchesToShow = isToday ? upcoming : schedule.matches;
  const dateLabel = formatDateLabel(isToday ? todayAnchor : tomorrowAnchor);

  const lines = matchesToShow
    .map(m => {
      const originalIndex = schedule.matches.indexOf(m) + 1; // keep original Match 1/2 numbering
      return `⏰ **Match ${originalIndex}** — IDP ${m.idp} PM | Start ${m.start} PM | ${m.map}`;
    })
    .join('\n');

  return `📅 **${isToday ? 'Today' : 'Tomorrow'}, ${dateLabel}**\n${lines}`;
}

function continueRow(customId, label) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(ButtonStyle.Primary)
  );
}

function retryRow(customId, label) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(ButtonStyle.Danger)
  );
}

function buildPlayerSelectRow() {
  const menu = new UserSelectMenuBuilder()
    .setCustomId('reg_select_players')
    .setPlaceholder('Select the 4 players who will play')
    .setMinValues(4)
    .setMaxValues(4);
  return new ActionRowBuilder().addComponents(menu);
}

// Attempts to assign the given team data a free scrim slot. Mutates
// store.scrim.slots in place on success — caller is responsible for saving.
// Returns { assigned } or { error }.
function assignSlot(store, userId, data) {
  const scrim = store.scrim;
  if (!scrim || !scrim.open) {
    return { error: '❌ Registration is not open right now — but your team profile has been saved for when it is.' };
  }

  const dupe = Object.values(scrim.slots).find(
    s => s.userId === userId || s.team.toLowerCase() === data.team_name.toLowerCase()
  );
  if (dupe) {
    return { error: `❌ You or a team named **${data.team_name}** is already registered in slot **${dupe.slotNumber}**.` };
  }

  let assigned = null;
  for (let i = FIRST_ASSIGNABLE_SLOT; i <= scrim.totalSlots; i++) {
    if (!scrim.slots[i]) { assigned = i; break; }
  }
  if (assigned === null) {
    return { error: '❌ Sorry, all slots are full — but your team profile has been saved for the next scrim.' };
  }

  const group = groupLetterForSlot(assigned);

  // The scrim slot list only ever displayed 4 players (Player 5 is the
  // designated substitute in /verify-panel's own wording), so that's what
  // gets shown here too — consistent with how slots have always looked.
  scrim.slots[assigned] = {
    team: data.team_name,
    ownerName: data.owner_name,
    whatsapp: data.whatsapp,
    players: [1, 2, 3, 4].map(n => `${data[`p${n}_ign`]} (${data[`p${n}_uid`]})`),
    userId,
    registeredAt: new Date().toISOString(),
    slotNumber: assigned,
    group,
  };

  return { assigned, group };
}

// --- "Register Team" button pressed ---
async function handleRegisterTeamButton(interaction) {
  const store = getGuildStore(interaction.guildId);
  const scrim = store.scrim;

  if (!scrim || !scrim.open) {
    return interaction.reply({ content: '❌ Registration is not open right now.', flags: MessageFlags.Ephemeral });
  }

  const already = Object.values(scrim.slots).find(s => s.userId === interaction.user.id);
  if (already) {
    return interaction.reply({
      content: '❌ You\'ve already registered — here are your details again:',
      embeds: [buildAlreadyRegisteredEmbed(already, scrim.scrimName)],
      flags: MessageFlags.Ephemeral,
    });
  }

  const saved = store.verifications && store.verifications[interaction.user.id];

  // Registration is only open to players who've already verified their team
  // through /verify-panel — that's what builds the saved profile this whole
  // register flow reuses. No profile means no register options at all.
  if (!saved) {
    return interaction.reply({
      content: "❌ You need to verify your team first. Head to the verification panel and complete `/verify-panel` before you can register.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('register_use_old').setLabel('Use Old Team').setEmoji('📁').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('register_edit_team').setLabel('Edit Team').setEmoji('✏️').setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({
    content: `You have a saved team profile: **${saved.team_name}**`,
    components: [row1],
    flags: MessageFlags.Ephemeral,
  });
}

function buildRegistrationCompleteEmbed(data, slotNumber, group, scrimName) {
  return new EmbedBuilder()
    .setTitle('🎯 Registration Complete!')
    .setColor(0x57F287)
    .setDescription(
      `🏆 **Team** — ${data.team_name}\n` +
      `🔰 **Group** — ${group}\n` +
      `🎮 **Assigned Slot** — ${slotNumber}\n` +
      `🗓️ **Scrim** — ${scrimName}\n\n` +
      `${matchScheduleLines(group)}\n\n` +
      'Please wait for the slot list to be posted.'
    )
    .setFooter({ text: 'Best of luck 👊 for your matches!!' });
}

// Shown when someone clicks "Register Team" again after already registering —
// re-displays their full slot details, so dismissing the original
// registration-complete message isn't a problem; they can just check again.
function buildAlreadyRegisteredEmbed(slotData, scrimName) {
  return new EmbedBuilder()
    .setTitle('📋 Your Registration')
    .setColor(0x5865F2)
    .setDescription(
      `🏆 **Team** — ${slotData.team}\n` +
      `🔰 **Group** — ${slotData.group}\n` +
      `🎮 **Assigned Slot** — ${slotData.slotNumber}\n` +
      `🗓️ **Scrim** — ${scrimName}\n\n` +
      `${matchScheduleLines(slotData.group)}`
    )
    .setFooter({ text: `Registered ${new Date(slotData.registeredAt).toUTCString()}` });
}

// Posted to the channel configured via /set-registration-channel — a
// staff-facing summary (team, owner mention, group/slot, full lineup)
// rather than the plain grid shown to the player themselves.
function buildRegistrationLogEmbed(data, ownerId, slotNumber, group, scrimName) {
  return new EmbedBuilder()
    .setTitle('🎯 Registration Complete!')
    .setColor(0x57F287)
    .setDescription(
      `🏆 **Team** — ${data.team_name}\n` +
      `👤 **Owner** — <@${ownerId}>\n` +
      `🔰 **Group** — ${group}\n` +
      `🎮 **Assigned Slot** — ${slotNumber}\n` +
      `🗓️ **Scrim** — ${scrimName}\n\n` +
      `${matchScheduleLines(group)}\n\n` +
      'Please wait for the slot list to be posted.'
    )
    .setFooter({ text: 'Best of luck 👊 for your matches!!' });
}

// Posts the registration summary to the configured channel, if one is set.
// Never throws — a missing channel, missing permissions, or the channel
// being deleted shouldn't ever block the player's own confirmation.
async function postRegistrationLog(interaction, store, data, ownerId, result) {
  const channelId = store.settings && store.settings.registrationLogChannelId;
  if (!channelId) return;

  try {
    const logChannel = await interaction.client.channels.fetch(channelId);
    await logChannel.send({
      embeds: [buildRegistrationLogEmbed(data, ownerId, result.assigned, result.group, store.scrim.scrimName)],
    });
  } catch (err) {
    console.error('Failed to post registration to log channel:', err);
  }
}

// Shown after a standalone profile edit (the "Edit Team" button on the main
// panel) — confirms the saved details without implying anything about scrim
// slot/group, since this path never touches scrim.slots.
function buildProfileUpdatedEmbed(data) {
  const playerLines = [1, 2, 3, 4, 5]
    .filter(n => n < 5 || data.p5_ign) // Player 5 is optional — omit the line entirely if not filled in
    .map(n => `**${data[`p${n}_ign`]}** / ${data[`p${n}_uid`]}`)
    .join('\n');
  const lineupLine = (data.selectedPlayerIds || []).map(id => `<@${id}>`).join(' ') || '_not selected_';

  return new EmbedBuilder()
    .setTitle('✏️ Team Profile Updated')
    .setColor(0x5865F2)
    .setDescription(
      `🏆 **Team** — ${data.team_name}\n\n` +
      `**Players (IGN/UID)**\n${playerLines}\n\n` +
      `**Playing Lineup:** ${lineupLine}\n\n` +
      "This won't register you for a scrim by itself — use **Register Team** for that."
    )
    .setFooter({ text: `Updated ${new Date().toUTCString()}` });
}

// --- "Edit Team" button pressed directly on the main /register panel ---
// Lets a player update their saved profile (name, contacts, roster) at any
// time — including when they're already registered for the current scrim,
// unlike the in-flow "Edit Team" option which is only reachable pre-registration.
// Deliberately never touches scrim.slots, so it can't collide with an
// existing slot assignment or accidentally re-register someone.
async function handleEditTeamDirectButton(interaction) {
  const store = getGuildStore(interaction.guildId);
  const saved = store.verifications && store.verifications[interaction.user.id];

  if (!saved) {
    return interaction.reply({
      content: "❌ You don't have a saved team profile yet — use **Register Team** first to create one.",
      flags: MessageFlags.Ephemeral,
    });
  }

  startPending(interaction.user.id, interaction.guildId, 'edit-only', saved);
  await interaction.showModal(buildVerifyStep1Modal(saved));
}

// Gives the configured "registered" role (set via /set-register-role), if
// one is configured. Never throws — a missing role, missing permissions, or
// the member having left shouldn't ever block registration itself from completing.
async function giveRegisteredRole(interaction, store) {
  const roleId = store.settings && store.settings.registeredRoleId;
  if (!roleId) return;

  try {
    const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);
    if (!member.roles.cache.has(roleId)) {
      await member.roles.add(roleId);
    }
  } catch (err) {
    console.error(`Failed to give registered role to ${interaction.user.id}:`, err);
  }
}

// --- "Use Old Team" pressed ---
async function handleUseOldTeam(interaction) {
  const store = getGuildStore(interaction.guildId);
  const saved = store.verifications && store.verifications[interaction.user.id];

  if (!saved) {
    return interaction.update({
      content: "❌ Your saved profile isn't available anymore — use **Register New Team** instead.",
      components: [],
    });
  }

  const result = assignSlot(store, interaction.user.id, saved);
  saveGuildStore(interaction.guildId, store);

  if (result.error) {
    return interaction.update({ content: result.error, components: [] });
  }

  await giveRegisteredRole(interaction, store);
  await postRegistrationLog(interaction, store, saved, interaction.user.id, result);

  await interaction.update({
    content: null,
    embeds: [buildRegistrationCompleteEmbed(saved, result.assigned, result.group, store.scrim.scrimName)],
    components: [],
  });
}

// --- "Edit Team" pressed — reopens the verify-style form prefilled with the saved profile ---
async function handleEditTeam(interaction) {
  const store = getGuildStore(interaction.guildId);
  const saved = store.verifications && store.verifications[interaction.user.id];

  if (!saved) {
    return interaction.update({
      content: "❌ Your saved profile isn't available anymore — use **Register New Team** instead.",
      components: [],
    });
  }

  startPending(interaction.user.id, interaction.guildId, 'edit', saved);
  await interaction.showModal(buildVerifyStep1Modal(saved));
}

// --- "Register New Team" pressed — same verify-style form, starting blank ---
async function handleNewTeam(interaction) {
  startPending(interaction.user.id, interaction.guildId, 'create');
  await interaction.showModal(buildVerifyStep1Modal());
}

// --- Step 1/3 submitted: team name, owner, whatsapp, email, city ---
async function handleRegStep1Submit(interaction) {
  const team_name = interaction.fields.getTextInputValue('team_name').trim();
  const owner_name = interaction.fields.getTextInputValue('owner_name').trim();
  const whatsapp = interaction.fields.getTextInputValue('whatsapp').trim();
  const owner_email = interaction.fields.getTextInputValue('owner_email').trim();
  const city = interaction.fields.getTextInputValue('city').trim();

  if (!getPending(interaction.user.id)) startPending(interaction.user.id, interaction.guildId, 'create');
  updatePending(interaction.user.id, { team_name, owner_name, whatsapp, owner_email, city });

  if (!WHATSAPP_RE.test(whatsapp)) {
    return interaction.reply({
      content: "❌ That WhatsApp number doesn't look valid (digits only, 7-15 digits, optional leading +). Tap **Try Again** to fix it — your other answers are kept.",
      components: [retryRow('reg_retry_step1', 'Try Again')],
      flags: MessageFlags.Ephemeral,
    });
  }
  if (!EMAIL_RE.test(owner_email)) {
    return interaction.reply({
      content: "❌ That email address doesn't look valid. Tap **Try Again** to fix it — your other answers are kept.",
      components: [retryRow('reg_retry_step1', 'Try Again')],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.reply({
    content: '✅ Step 1 saved. Continue to enter Player 1 and Player 2 details.',
    components: [continueRow('reg_continue_2', 'Continue to Players 1 & 2')],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRegRetryStep1(interaction) {
  const pending = getPending(interaction.user.id);
  if (!pending) {
    return interaction.reply({ content: `❌ Your session expired or was interrupted. ${RESTART_HINT}`, flags: MessageFlags.Ephemeral });
  }
  await interaction.showModal(buildVerifyStep1Modal(pending.data));
}

async function handleRegStep2Button(interaction) {
  const pending = getPending(interaction.user.id);
  if (!pending) {
    return interaction.reply({ content: `❌ Your session expired or was interrupted. ${RESTART_HINT}`, flags: MessageFlags.Ephemeral });
  }
  await interaction.showModal(buildVerifyStep2Modal(pending.original));
}

// --- Step 2/3 submitted: player 1 & 2 ---
async function handleRegStep2Submit(interaction) {
  const pending = getPending(interaction.user.id);
  if (!pending) {
    return interaction.reply({ content: `❌ Your session expired or was interrupted. ${RESTART_HINT}`, flags: MessageFlags.Ephemeral });
  }

  const p1_ign = interaction.fields.getTextInputValue('p1_ign').trim();
  const p1_uid = interaction.fields.getTextInputValue('p1_uid').trim();
  const p2_ign = interaction.fields.getTextInputValue('p2_ign').trim();
  const p2_uid = interaction.fields.getTextInputValue('p2_uid').trim();

  updatePending(interaction.user.id, { p1_ign, p1_uid, p2_ign, p2_uid });

  for (const [label, uid] of [['Player 1', p1_uid], ['Player 2', p2_uid]]) {
    if (!UID_RE.test(uid)) {
      return interaction.reply({
        content: `❌ ${label}'s Game UID must be numbers only (5-12 digits). Tap **Try Again** to fix it — your other answers are kept.`,
        components: [retryRow('reg_retry_step2', 'Try Again')],
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  await interaction.reply({
    content: '✅ Step 2 saved. Continue to enter Player 3, Player 4 and Player 5 details.',
    components: [continueRow('reg_continue_3', 'Continue to Player 3, 4 & 5')],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRegRetryStep2(interaction) {
  const pending = getPending(interaction.user.id);
  if (!pending) {
    return interaction.reply({ content: `❌ Your session expired or was interrupted. ${RESTART_HINT}`, flags: MessageFlags.Ephemeral });
  }
  await interaction.showModal(buildVerifyStep2Modal(pending.data));
}

async function handleRegStep3Button(interaction) {
  const pending = getPending(interaction.user.id);
  if (!pending) {
    return interaction.reply({ content: `❌ Your session expired or was interrupted. ${RESTART_HINT}`, flags: MessageFlags.Ephemeral });
  }
  await interaction.showModal(buildVerifyStep3Modal(pending.original));
}

// --- Step 3/3 submitted: player 3, 4, 5 -> ask which 4 play ---
async function handleRegStep3Submit(interaction) {
  const pendingEntry = getPending(interaction.user.id);
  if (!pendingEntry) {
    return interaction.reply({ content: `❌ Your session expired or was interrupted. ${RESTART_HINT}`, flags: MessageFlags.Ephemeral });
  }

  const p3_ign = interaction.fields.getTextInputValue('p3_ign').trim();
  const p3_uid = interaction.fields.getTextInputValue('p3_uid').trim();
  const p4_ign = interaction.fields.getTextInputValue('p4_ign').trim();
  const p4_uid = interaction.fields.getTextInputValue('p4_uid').trim();
  const p5_combined = interaction.fields.getTextInputValue('p5_combined').trim();

  updatePending(interaction.user.id, { p3_ign, p3_uid, p4_ign, p4_uid, p5_combined });

  for (const [label, uid] of [['Player 3', p3_uid], ['Player 4', p4_uid]]) {
    if (!UID_RE.test(uid)) {
      return interaction.reply({
        content: `❌ ${label}'s Game UID must be numbers only (5-12 digits). Tap **Try Again** to fix it — your other answers are kept.`,
        components: [retryRow('reg_retry_step3', 'Try Again')],
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  const p5Match = p5_combined ? P5_COMBINED_RE.exec(p5_combined) : null;
  if (p5_combined && !p5Match) {
    return interaction.reply({
      content: '❌ Player 5 must be in the format **IGN - UID** (e.g. `ProGamer123 - 5123456789`), or left blank if there is no Player 5. Tap **Try Again** to fix it — your other answers are kept.',
      components: [retryRow('reg_retry_step3', 'Try Again')],
      flags: MessageFlags.Ephemeral,
    });
  }
  const p5_ign = p5Match ? p5Match[1].trim() : '';
  const p5_uid = p5Match ? p5Match[2].trim() : '';
  updatePending(interaction.user.id, { p5_ign, p5_uid });

  const entry = getPending(interaction.user.id);
  const requiredFields = [
    'team_name', 'owner_name', 'whatsapp', 'owner_email', 'city',
    'p1_ign', 'p1_uid', 'p2_ign', 'p2_uid', 'p3_ign', 'p3_uid', 'p4_ign', 'p4_uid',
  ];
  const missing = requiredFields.filter(f => !entry.data[f]);
  if (missing.length) {
    clearPending(interaction.user.id);
    return interaction.reply({ content: `❌ Registration incomplete — some details were missing. ${RESTART_HINT}`, flags: MessageFlags.Ephemeral });
  }

  await interaction.reply({
    content: '✅ Step 3 saved. Last step — select the **4 players from this server** who will play:',
    components: [buildPlayerSelectRow()],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRegRetryStep3(interaction) {
  const pending = getPending(interaction.user.id);
  if (!pending) {
    return interaction.reply({ content: `❌ Your session expired or was interrupted. ${RESTART_HINT}`, flags: MessageFlags.Ephemeral });
  }
  await interaction.showModal(buildVerifyStep3Modal(pending.data));
}

// --- Final step: pick 4 real Discord members -> save profile + assign a slot ---
async function handleRegSelectPlayers(interaction) {
  const pendingEntry = getPending(interaction.user.id);
  if (!pendingEntry) {
    return interaction.reply({ content: `❌ Your session expired or was interrupted. ${RESTART_HINT}`, flags: MessageFlags.Ephemeral });
  }

  const data = { ...pendingEntry.data, selectedPlayerIds: interaction.values };

  const store = getGuildStore(interaction.guildId);
  if (!store.verifications) store.verifications = {};
  if (!store.settings) store.settings = {};

  const existingRecord = store.verifications[interaction.user.id];
  if (existingRecord) {
    data.teamNumber = existingRecord.teamNumber;
    data.registeredDate = existingRecord.registeredDate;
  } else {
    data.teamNumber = (store.settings.verifyTeamCounter || 0) + 1;
    store.settings.verifyTeamCounter = data.teamNumber;
    data.registeredDate = new Date().toISOString();
  }

  // Keep their saved profile in sync regardless of whether a slot is free
  // right now, so "Use Old Team" reflects these details next time either way.
  store.verifications[interaction.user.id] = data;

  // Standalone profile edit from the main panel — save and stop here, never
  // touching scrim.slots or the registered role.
  if (pendingEntry.mode === 'edit-only') {
    saveGuildStore(interaction.guildId, store);
    clearPending(interaction.user.id);
    return interaction.update({
      content: null,
      embeds: [buildProfileUpdatedEmbed(data)],
      components: [],
    });
  }

  const result = assignSlot(store, interaction.user.id, data);
  saveGuildStore(interaction.guildId, store);
  clearPending(interaction.user.id);

  if (result.error) {
    return interaction.update({ content: result.error, components: [] });
  }

  await giveRegisteredRole(interaction, store);
  await postRegistrationLog(interaction, store, data, interaction.user.id, result);

  await interaction.update({
    content: null,
    embeds: [buildRegistrationCompleteEmbed(data, result.assigned, result.group, store.scrim.scrimName)],
    components: [],
  });
}

module.exports = {
  handleRegisterTeamButton,
  handleUseOldTeam,
  handleEditTeam,
  handleEditTeamDirectButton,
  handleNewTeam,
  handleRegStep1Submit,
  handleRegRetryStep1,
  handleRegStep2Button,
  handleRegStep2Submit,
  handleRegRetryStep2,
  handleRegStep3Button,
  handleRegStep3Submit,
  handleRegRetryStep3,
  handleRegSelectPlayers,
};
