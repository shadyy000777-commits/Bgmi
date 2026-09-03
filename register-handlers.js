const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags,
  UserSelectMenuBuilder, StringSelectMenuBuilder, ChannelType, PermissionFlagsBits,
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

const {
  FIRST_ASSIGNABLE_SLOT, TEAMS_PER_GROUP, groupLetterForSlot, groupDisplayName,
  localSlotNumber, slotRangeForGroup, listGroupsWithFreeSlots, matchScheduleLines, groupTimeSummary,
} = require('./group-schedule');
const { refreshLivePanel, refreshGroupSlotList } = require('./live-panel-handlers');

// Discord's own hard caps, so auto-creating a role/channel per group can't
// silently start erroring out once a long-running scrim has racked up a
// lot of groups — we stop (and log) a bit before actually hitting them.
const MAX_GUILD_ROLES = 250;
const MAX_GUILD_CHANNELS = 500;
const SAFETY_MARGIN = 5;

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

// Whether any of the newly-picked player IDs is already locked in as part
// of another team's lineup for this scrim — a player can only ever be on
// one team's roster at a time. Returns the conflicting user ID and the
// team they're already on, or null if there's no overlap.
function findLineupConflict(scrim, selectedIds) {
  if (!scrim) return null;
  for (const slot of Object.values(scrim.slots)) {
    for (const id of slot.selectedPlayerIds || []) {
      if (selectedIds.includes(id)) {
        return { conflictId: id, team: slot.team };
      }
    }
  }
  return null;
}

// Attempts to assign the given team data a free scrim slot. Mutates
// store.scrim.slots in place on success — caller is responsible for saving.
// Returns { assigned } or { error }.
function assignSlot(store, userId, data) {
  const scrim = store.scrim;
  if (!scrim) {
    return { error: '❌ No scrim is set up right now — but your team profile has been saved for when one is.' };
  }

  const dupe = Object.values(scrim.slots).find(
    s => s.userId === userId || s.team.toLowerCase() === data.team_name.toLowerCase()
  );
  if (dupe) {
    return { error: `❌ You or a team named **${data.team_name}** is already registered in slot **${localSlotNumber(dupe.slotNumber)}**.` };
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
    // The 4-person playing lineup's Discord accounts, if this registration
    // went through the lineup-select step — used by !punishteam to ban a
    // team's whole roster, not just the owner. Older registrations from
    // before this step existed simply won't have any here.
    selectedPlayerIds: data.selectedPlayerIds || [],
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

  if (!scrim) {
    return interaction.reply({ content: '❌ No scrim is set up right now.', flags: MessageFlags.Ephemeral });
  }

  const already = Object.values(scrim.slots).find(s => s.userId === interaction.user.id);
  if (already) {
    return interaction.reply({
      content: '❌ You\'ve already registered — here are your details again:',
      embeds: [buildAlreadyRegisteredEmbed(already, scrim.scrimName, store)],
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

function confirmRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('reg_confirm_register').setLabel('Confirm Registration').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('reg_cancel_register').setLabel('Cancel').setEmoji('✖️').setStyle(ButtonStyle.Danger)
  );
}

// Shown right after the player picks their 4-person lineup, before a slot
// is actually assigned — a temporary/ephemeral summary of just the
// essentials so they can double-check before it's locked in. Deliberately
// keeps it to the fields that matter to catch typos in: full IGN/UID pairs
// and city aren't shown here, just team name, owner, the 4 player names,
// WhatsApp, and email.
function buildRegistrationPreviewEmbed(data) {
  return new EmbedBuilder()
    .setTitle('📝 Review Your Registration')
    .setColor(0xFEE75C)
    .setDescription(
      `**Team Name** — ${data.team_name}\n` +
      `**Owner Name** — ${data.owner_name}\n` +
      `**Player 1** — ${data.p1_ign}\n` +
      `**Player 2** — ${data.p2_ign}\n` +
      `**Player 3** — ${data.p3_ign}\n` +
      `**Player 4** — ${data.p4_ign}\n` +
      `**WhatsApp** — ${data.whatsapp}\n` +
      `**Email** — ${data.owner_email}`
    )
    .setFooter({ text: 'Double-check everything, then tap Confirm to lock in your slot.' });
}

function buildRegistrationCompleteEmbed(data, slotNumber, group, scrimName, store) {
  const lineup = (data.selectedPlayerIds || []).map(id => `<@${id}>`).join(' ') || '_not selected_';

  return new EmbedBuilder()
    .setTitle('🎯 Registration Complete!')
    .setColor(0x57F287)
    .setDescription(
      `<a:emoji_14:1544290922043543552> **Team** — ${data.team_name}\n` +
      `🔰 **Group** — ${groupDisplayName(group)}\n` +
      `🎮 **Assigned Slot** — ${localSlotNumber(slotNumber)}\n` +
      `🗓️ **Scrim** — ${scrimName}\n` +
      `👥 **Players** — ${lineup}\n\n` +
      `${matchScheduleLines(group, store)}\n\n` +
      'Please wait for the slot list to be posted.'
    )
    .setFooter({ text: 'Best of luck 👊 for your matches!!' });
}

// Shown when someone clicks "Register Team" again after already registering —
// re-displays their full slot details, so dismissing the original
// registration-complete message isn't a problem; they can just check again.
function buildAlreadyRegisteredEmbed(slotData, scrimName, store) {
  const lineup = (slotData.selectedPlayerIds || []).map(id => `<@${id}>`).join(' ') || '_not selected_';

  return new EmbedBuilder()
    .setTitle('📋 Your Registration')
    .setColor(0x5865F2)
    .setDescription(
      `<a:emoji_14:1544290922043543552> **Team** — ${slotData.team}\n` +
      `🔰 **Group** — ${groupDisplayName(slotData.group)}\n` +
      `🎮 **Assigned Slot** — ${localSlotNumber(slotData.slotNumber)}\n` +
      `🗓️ **Scrim** — ${scrimName}\n` +
      `👥 **Players** — ${lineup}\n\n` +
      `${matchScheduleLines(slotData.group, store)}`
    )
    .setFooter({ text: `Registered ${new Date(slotData.registeredAt).toUTCString()}` });
}

// Posted to the channel configured via /set-registration-channel — a
// staff-facing summary (team, owner mention, group/slot, full lineup)
// rather than the plain grid shown to the player themselves.
function buildRegistrationLogEmbed(data, ownerId, slotNumber, group, scrimName, store, isSlotChange = false) {
  return new EmbedBuilder()
    .setTitle(isSlotChange ? '🔄 Slot Changed' : '🎯 Registration Complete!')
    .setColor(isSlotChange ? 0x5865F2 : 0x57F287)
    .setDescription(
      // data may be a verification profile (team_name) or a raw scrim.slots
      // entry (team) depending on the caller — support either shape.
      `<a:emoji_14:1544290922043543552> **Team** — ${data.team_name || data.team}\n` +
      `👤 **Owner** — <@${ownerId}>\n` +
      `🔰 **Group** — ${groupDisplayName(group)}\n` +
      `🎮 **Assigned Slot** — ${localSlotNumber(slotNumber)}\n` +
      `🗓️ **Scrim** — ${scrimName}\n\n` +
      `${matchScheduleLines(group, store)}\n\n` +
      'Please wait for the slot list to be posted.'
    )
    .setFooter({ text: 'Best of luck 👊 for your matches!!' });
}

// Posts the registration summary to the configured channel, if one is set.
// Never throws — a missing channel, missing permissions, or the channel
// being deleted shouldn't ever block the player's own confirmation.
async function postRegistrationLog(interaction, store, data, ownerId, result, isSlotChange = false) {
  const channelId = store.settings && store.settings.registrationLogChannelId;
  if (!channelId) return;

  try {
    const logChannel = await interaction.client.channels.fetch(channelId);
    await logChannel.send({
      embeds: [buildRegistrationLogEmbed(data, ownerId, result.assigned, result.group, store.scrim.scrimName, store, isSlotChange)],
    });
  } catch (err) {
    console.error('Failed to post registration to log channel:', err);
  }
}

// --- "Change Slot" button pressed on the main /register panel ---
// Only usable by players who are already registered for the current scrim —
// lets them move to a different group (and therefore a different match
// time) by picking from groups that currently have an open slot.
async function handleChangeSlotButton(interaction) {
  const store = getGuildStore(interaction.guildId);
  const scrim = store.scrim;

  if (!scrim) {
    return interaction.reply({ content: '❌ No scrim is set up right now.', flags: MessageFlags.Ephemeral });
  }

  const already = Object.values(scrim.slots).find(s => s.userId === interaction.user.id);
  if (!already) {
    return interaction.reply({
      content: '❌ You need to register your team first — use **Register Team**, then you can change your slot.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const options = listGroupsWithFreeSlots(scrim)
    .filter(g => g.freeCount > 0 && g.letter !== already.group)
    .slice(0, 25) // Discord's select menu option cap
    .map(g => ({
      label: groupDisplayName(g.letter),
      description: `${groupTimeSummary(g.letter, store)} — ${g.freeCount} slot(s) free`,
      value: g.letter,
    }));

  if (options.length === 0) {
    return interaction.reply({
      content: "❌ No other group currently has a free slot to switch into — you're staying in your current group for now.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId('change_slot_group_select')
    .setPlaceholder('Pick a group to switch into')
    .addOptions(options);

  await interaction.reply({
    content: `You're currently in **${groupDisplayName(already.group)}** (Slot ${localSlotNumber(already.slotNumber)}). Pick a different group below to switch your match time:`,
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

// --- Group picked from the "Change Slot" menu ---
// Re-checks everything fresh (no in-memory pending state needed) since the
// whole operation only reads/writes scrim.slots, which the select menu's
// customId + interaction.user.id is enough to look up again.
async function handleChangeSlotGroupSelect(interaction) {
  const store = getGuildStore(interaction.guildId);
  const scrim = store.scrim;
  const newGroup = interaction.values[0];

  if (!scrim) {
    return interaction.update({ content: '❌ No scrim is set up right now.', components: [] });
  }

  const already = Object.values(scrim.slots).find(s => s.userId === interaction.user.id);
  if (!already) {
    return interaction.update({ content: "❌ You're not currently registered for this scrim.", components: [] });
  }
  if (already.group === newGroup) {
    return interaction.update({ content: `You're already in ${groupDisplayName(newGroup)}.`, components: [] });
  }

  const range = slotRangeForGroup(newGroup, scrim.totalSlots);
  let newSlotNumber = null;
  for (let i = range.start; i <= range.end; i++) {
    if (!scrim.slots[i]) { newSlotNumber = i; break; }
  }
  if (newSlotNumber === null) {
    return interaction.update({
      content: `❌ ${groupDisplayName(newGroup)} just filled up — run **Change Slot** again to pick another group.`,
      components: [],
    });
  }

  const oldGroup = already.group;
  const teamData = scrim.slots[already.slotNumber];
  delete scrim.slots[already.slotNumber];
  teamData.slotNumber = newSlotNumber;
  teamData.group = newGroup;
  scrim.slots[newSlotNumber] = teamData;
  saveGuildStore(interaction.guildId, store);

  await giveGroupRole(interaction, store, newGroup, oldGroup);

  await postRegistrationLog(
    interaction, store, teamData, interaction.user.id,
    { assigned: newSlotNumber, group: newGroup }, true
  );
  await refreshLivePanel(interaction.client, interaction.guildId);
  await refreshGroupSlotList(interaction.client, interaction.guildId, newGroup);
  await refreshGroupSlotList(interaction.client, interaction.guildId, oldGroup);

  await interaction.update({
    content: null,
    embeds: [buildAlreadyRegisteredEmbed(teamData, scrim.scrimName, store)],
    components: [],
  });
}

// Gives the configured "registered" role (set via /set-register-role), if
// one is configured. Never throws — a missing role, missing permissions, or
// the member having left shouldn't ever block registration itself from completing.
async function giveRegisteredRole(interaction, store) {
  const roleId = store.settings && store.settings.registeredRoleId;
  if (!roleId) {
    console.warn(`[registered-role] No registeredRoleId configured for guild ${interaction.guildId} — run /set-register-role.`);
    return;
  }

  const role = interaction.guild.roles.cache.get(roleId);
  if (!role) {
    console.error(`[registered-role] Configured role ${roleId} no longer exists in guild ${interaction.guildId} — re-run /set-register-role.`);
    return;
  }

  const botMember = interaction.guild.members.me;
  if (!botMember.permissions.has('ManageRoles')) {
    console.error(`[registered-role] Bot is missing the "Manage Roles" permission in guild ${interaction.guildId}.`);
    return;
  }
  if (role.position >= botMember.roles.highest.position) {
    console.error(`[registered-role] Bot's highest role is below "${role.name}" (${roleId}) in guild ${interaction.guildId} — move the bot's role above it.`);
    return;
  }

  try {
    const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);
    if (!member.roles.cache.has(roleId)) {
      await member.roles.add(roleId);
    }
  } catch (err) {
    console.error(`[registered-role] Failed to give role ${roleId} to ${interaction.user.id} in guild ${interaction.guildId}: ${err.code ?? ''} ${err.message}`);
  }
}

// Gives the role for `newGroupLetter` — auto-creating it the first time
// anyone lands in that group, so admins don't have to pre-create/configure
// a role per group via /set-group-role for scrims with many groups. If a
// role WAS manually configured via /set-group-role, that one is used
// instead (manual config always wins). If the player was previously in a
// different group with a different role, that old role is removed first,
// so a player only ever holds one group role at a time. Never throws, same
// reasoning as giveRegisteredRole: a role hiccup should never block
// registration.
async function giveGroupRole(interaction, store, newGroupLetter, previousGroupLetter) {
  if (!store.settings) store.settings = {};
  if (!store.settings.groupRoles) store.settings.groupRoles = {};
  if (!store.settings.autoGroupRoleIds) store.settings.autoGroupRoleIds = [];
  const groupRoles = store.settings.groupRoles;
  const oldRoleId = previousGroupLetter ? groupRoles[previousGroupLetter] : null;

  const botMember = interaction.guild.members.me;
  if (!botMember.permissions.has('ManageRoles')) {
    console.error(`[group-role] Bot is missing the "Manage Roles" permission in guild ${interaction.guildId}.`);
    return null;
  }

  let newRole = groupRoles[newGroupLetter] ? interaction.guild.roles.cache.get(groupRoles[newGroupLetter]) : null;

  if (!newRole) {
    if (interaction.guild.roles.cache.size >= MAX_GUILD_ROLES - SAFETY_MARGIN) {
      console.error(`[group-role] Guild ${interaction.guildId} is at/near Discord's ${MAX_GUILD_ROLES}-role cap — skipping auto-create for Group ${newGroupLetter}.`);
      return null;
    }
    try {
      newRole = await interaction.guild.roles.create({
        name: groupDisplayName(newGroupLetter),
        mentionable: false,
        reason: `Auto-created for ${groupDisplayName(newGroupLetter)} registration`,
      });
      groupRoles[newGroupLetter] = newRole.id;
      store.settings.autoGroupRoleIds.push(newRole.id);
      saveGuildStore(interaction.guildId, store);
    } catch (err) {
      console.error(`[group-role] Failed to auto-create role for Group ${newGroupLetter} in guild ${interaction.guildId}: ${err.code ?? ''} ${err.message}`);
      return null;
    }
  }

  // The group channel just needs the role to exist to scope its
  // permissions to — it doesn't care about role hierarchy, so this can
  // happen regardless of whether the position check below passes.
  await giveGroupChannel(interaction, store, newGroupLetter, newRole.id);

  if (newRole.position >= botMember.roles.highest.position) {
    console.error(`[group-role] Bot's highest role is below "${newRole.name}" (${newRole.id}) in guild ${interaction.guildId} — move the bot's role above it.`);
    return newRole;
  }

  try {
    const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);

    if (oldRoleId && oldRoleId !== newRole.id && member.roles.cache.has(oldRoleId)) {
      await member.roles.remove(oldRoleId);
    }

    if (!member.roles.cache.has(newRole.id)) {
      await member.roles.add(newRole.id);
    }
  } catch (err) {
    console.error(`[group-role] Failed to update group role for ${interaction.user.id} in guild ${interaction.guildId}: ${err.code ?? ''} ${err.message}`);
  }

  return newRole;
}

// Creates (once per group) a private text channel scoped to that group's
// role — @everyone can't see it, only players holding the group's role
// (and admins/roles that already bypass channel overwrites) can. Mirrors
// giveGroupRole: skipped if a channel was already created for this group,
// and cleaned up alongside the role when the scrim is deleted. Never
// throws — a channel hiccup should never block registration.
async function giveGroupChannel(interaction, store, groupLetter, roleId) {
  if (!roleId) return;
  if (!store.settings) store.settings = {};
  if (!store.settings.groupChannels) store.settings.groupChannels = {};
  if (!store.settings.autoGroupChannelIds) store.settings.autoGroupChannelIds = [];
  const groupChannels = store.settings.groupChannels;

  const existingId = groupChannels[groupLetter];
  if (existingId && interaction.guild.channels.cache.get(existingId)) return; // already made

  const botMember = interaction.guild.members.me;
  if (!botMember.permissions.has('ManageChannels')) {
    console.error(`[group-channel] Bot is missing the "Manage Channels" permission in guild ${interaction.guildId}.`);
    return;
  }

  if (interaction.guild.channels.cache.size >= MAX_GUILD_CHANNELS - SAFETY_MARGIN) {
    console.error(`[group-channel] Guild ${interaction.guildId} is at/near Discord's ${MAX_GUILD_CHANNELS}-channel cap — skipping auto-create for Group ${groupLetter}.`);
    return;
  }

  try {
    let category = store.settings.groupChannelsCategoryId
      ? interaction.guild.channels.cache.get(store.settings.groupChannelsCategoryId)
      : null;

    if (!category) {
      category = await interaction.guild.channels.create({
        name: '🏆 Group Channels',
        type: ChannelType.GuildCategory,
        reason: 'Auto-created to hold per-group scrim channels',
      });
      store.settings.groupChannelsCategoryId = category.id;
    }

    const slug = groupDisplayName(groupLetter).toLowerCase().replace(/\s+/g, '-'); // "Group 12" -> "group-12"
    const channel = await interaction.guild.channels.create({
      name: slug,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      ],
      reason: `Auto-created for ${groupDisplayName(groupLetter)} registration`,
    });

    groupChannels[groupLetter] = channel.id;
    store.settings.autoGroupChannelIds.push(channel.id);
    saveGuildStore(interaction.guildId, store);
  } catch (err) {
    console.error(`[group-channel] Failed to auto-create channel for Group ${groupLetter} in guild ${interaction.guildId}: ${err.code ?? ''} ${err.message}`);
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

  // Reuse the saved profile's details, but still make them pick this
  // scrim's playing lineup fresh — who's actually playing can change scrim
  // to scrim even when the team profile itself hasn't. Shows the saved
  // profile as a review embed (no Confirm/Cancel yet — those only appear
  // once the lineup below is picked) alongside the player-select menu.
  // handleRegSelectPlayers (the same handler the "Register New Team" flow
  // ends on) takes it from here.
  const entry = startPending(interaction.user.id, interaction.guildId, 'use-old-team');
  Object.assign(entry.data, saved);

  await interaction.update({
    content: '✅ Using your saved team profile. Review it below, then select the **4 players from this server** who will play:',
    embeds: [buildRegistrationPreviewEmbed(entry.data)],
    components: [buildPlayerSelectRow()],
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
    content: '✅ Step 3 saved. Review your details below, then select the **4 players from this server** who will play:',
    embeds: [buildRegistrationPreviewEmbed(entry.data)],
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

// --- Final step: pick 4 real Discord members -> show a review screen ---
// Nothing is saved or assigned yet here — this just stages the full
// submission (including the chosen lineup) in the pending entry and shows
// the player a temporary summary to double-check before anything is
// locked in. The actual save/slot-assignment happens in
// handleRegConfirmRegister once they tap Confirm.
async function handleRegSelectPlayers(interaction) {
  const pendingEntry = getPending(interaction.user.id);
  if (!pendingEntry) {
    return interaction.reply({ content: `❌ Your session expired or was interrupted. ${RESTART_HINT}`, flags: MessageFlags.Ephemeral });
  }

  // Bots can't be a playing member of a team lineup.
  const botPicked = interaction.users.find(u => u.bot);
  if (botPicked) {
    return interaction.update({
      content: `❌ ${botPicked} is a bot and can't be picked as a player. Pick 4 human players below:`,
      embeds: [],
      components: [buildPlayerSelectRow()],
    });
  }

  // A player can only be on one team's lineup at a time — block picking
  // someone who's already locked into another team's roster for this scrim.
  const store = getGuildStore(interaction.guildId);
  const conflict = findLineupConflict(store.scrim, interaction.values);
  if (conflict) {
    return interaction.update({
      content: `❌ <@${conflict.conflictId}> is already registered as a player on **${conflict.team}** and can't be picked again. Pick a different lineup below:`,
      embeds: [],
      components: [buildPlayerSelectRow()],
    });
  }

  updatePending(interaction.user.id, { selectedPlayerIds: interaction.values });
  const pending = getPending(interaction.user.id);

  // Standalone profile edit from the main panel isn't a scrim registration —
  // nothing to review/confirm, just save directly (matches prior behavior).
  if (pending.mode === 'edit-only') {
    const data = { ...pending.data };
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

    store.verifications[interaction.user.id] = data;
    saveGuildStore(interaction.guildId, store);
    clearPending(interaction.user.id);
    return interaction.update({
      content: null,
      embeds: [buildProfileUpdatedEmbed(data)],
      components: [],
    });
  }

  await interaction.update({
    content: null,
    embeds: [buildRegistrationPreviewEmbed(pending.data)],
    components: [confirmRow()],
  });
}

// --- "Confirm Registration" pressed on the review screen ---
// This is where the profile actually gets saved and a slot actually gets
// assigned — everything before this point was just staging + preview.
async function handleRegConfirmRegister(interaction) {
  const pendingEntry = getPending(interaction.user.id);
  if (!pendingEntry) {
    return interaction.update({ content: `❌ Your session expired or was interrupted. ${RESTART_HINT}`, embeds: [], components: [] });
  }

  const data = { ...pendingEntry.data };

  const store = getGuildStore(interaction.guildId);
  if (!store.verifications) store.verifications = {};
  if (!store.settings) store.settings = {};

  // Belt-and-suspenders: re-check for a lineup conflict here too, in case
  // another team grabbed one of these players in the gap between the
  // player-select step and this confirm tap.
  const conflict = findLineupConflict(store.scrim, data.selectedPlayerIds || []);
  if (conflict) {
    clearPending(interaction.user.id);
    return interaction.update({
      content: `❌ <@${conflict.conflictId}> just got locked into **${conflict.team}** by someone else. ${RESTART_HINT}`,
      embeds: [],
      components: [],
    });
  }

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

  const result = assignSlot(store, interaction.user.id, data);
  saveGuildStore(interaction.guildId, store);
  clearPending(interaction.user.id);

  if (result.error) {
    return interaction.update({ content: result.error, embeds: [], components: [] });
  }

  await giveRegisteredRole(interaction, store);
  await giveGroupRole(interaction, store, result.group, null);
  await postRegistrationLog(interaction, store, data, interaction.user.id, result);
  await refreshLivePanel(interaction.client, interaction.guildId);
  await refreshGroupSlotList(interaction.client, interaction.guildId, result.group);

  await interaction.update({
    content: null,
    embeds: [buildRegistrationCompleteEmbed(data, result.assigned, result.group, store.scrim.scrimName, store)],
    components: [],
  });
}

// --- "Cancel" pressed on the review screen ---
async function handleRegCancelRegister(interaction) {
  clearPending(interaction.user.id);
  await interaction.update({
    content: '❌ Registration cancelled — nothing was saved. Click **Register Team** again to start over.',
    embeds: [],
    components: [],
  });
}

module.exports = {
  handleRegisterTeamButton,
  handleUseOldTeam,
  handleEditTeam,
  handleChangeSlotButton,
  handleChangeSlotGroupSelect,
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
  handleRegConfirmRegister,
  handleRegCancelRegister,
};
