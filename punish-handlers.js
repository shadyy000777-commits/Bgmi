const {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, PermissionFlagsBits, MessageFlags,
} = require('discord.js');
const { getGuildStore, saveGuildStore, listGuildIds } = require('./storage');
const { slotRangeForGroup, groupDisplayName } = require('./group-schedule');
const { refreshLivePanel, refreshGroupSlotList } = require('./live-panel-handlers');
const { resolveLogChannel } = require('./log-channel');

// "Punishing" a team no longer bans them from the server outright — it
// gives them a role that blocks the Register button (see getScrimsBanExpiry
// below, checked from register-handlers.js/registration-handlers.js) for a
// fixed window, then the role comes off automatically. The role is
// auto-created the first time it's needed, same pattern as group roles.
const SCRIMS_BAN_DURATION_MS = 2 * 24 * 60 * 60 * 1000; // 2 days
const SCRIMS_BAN_ROLE_NAME = 'Scrims Ban';

async function getOrCreateScrimsBanRole(interaction, store) {
  if (!store.settings) store.settings = {};
  const existingId = store.settings.scrimsBanRoleId;
  const existing = existingId ? interaction.guild.roles.cache.get(existingId) : null;
  if (existing) return existing;

  const role = await interaction.guild.roles.create({
    name: SCRIMS_BAN_ROLE_NAME,
    color: 0x2C2F33,
    mentionable: false,
    reason: 'Auto-created for punishing teams (blocks registration for 2 days)',
  });
  store.settings.scrimsBanRoleId = role.id;
  saveGuildStore(interaction.guildId, store);
  return role;
}

// Returns the ban's expiry timestamp (ms) if `userId` is currently under an
// active scrims ban, or null if they're clear to register. Used by the
// register flow(s) to block the button, and cleared automatically once
// expired rather than left to linger in storage.
function getScrimsBanExpiry(store, userId) {
  const bans = store.settings && store.settings.scrimsBans;
  if (!bans || !bans[userId]) return null;
  if (bans[userId] <= Date.now()) {
    delete bans[userId];
    return null;
  }
  return bans[userId];
}

// Polls periodically and removes the Scrims Ban role (plus the tracking
// entry) from anyone whose 2-day window has elapsed, so nobody has to
// remember to lift it manually.
function startScrimsBanExpiry(client, intervalMs = 15 * 60 * 1000) {
  setInterval(async () => {
    for (const guildId of listGuildIds()) {
      const store = getGuildStore(guildId);
      const bans = store.settings && store.settings.scrimsBans;
      if (!bans || !Object.keys(bans).length) continue;

      const roleId = store.settings.scrimsBanRoleId;
      const now = Date.now();
      let changed = false;

      for (const [userId, expiresAt] of Object.entries(bans)) {
        if (expiresAt > now) continue;
        changed = true;
        delete bans[userId];

        if (roleId) {
          try {
            const guild = await client.guilds.fetch(guildId);
            const member = await guild.members.fetch(userId);
            if (member.roles.cache.has(roleId)) await member.roles.remove(roleId, 'Scrims ban expired (2 days)');
          } catch (err) {
            // Member left the server, or the role's gone — nothing more to do.
          }
        }
      }

      if (changed) saveGuildStore(guildId, store);
    }
  }, intervalMs);
}

function canPunish(interaction) {
  return interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)
    || interaction.member.permissions.has(PermissionFlagsBits.BanMembers);
}

// Builds the "pick team(s) to punish" select menu for one scrim group.
// Returns { error } instead of a payload when the group can't be shown.
function buildPunishSelectPayload(scrim, letter) {
  if (!letter) {
    return { error: "❌ Couldn't tell which group this channel is for. Name the channel like **group-a**, or run `!punishteam <letter>` (e.g. `!punishteam A`)." };
  }
  if (!scrim) {
    return { error: '❌ No scrim is set up right now.' };
  }

  const { start, end } = slotRangeForGroup(letter, scrim.totalSlots);
  const teamsInGroup = [];
  for (let i = start; i <= end; i++) {
    if (scrim.slots[i]) teamsInGroup.push({ slotNum: i, ...scrim.slots[i] });
  }

  if (!teamsInGroup.length) {
    return { error: `❌ Group **${letter}** has no registered teams.` };
  }
  if (teamsInGroup.length > 25) {
    return { error: `❌ Group **${letter}** has ${teamsInGroup.length} teams — Discord select menus cap at 25 options.` };
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(`punish_select_teams:${letter}`)
    .setPlaceholder(`Select team(s) to punish from Group ${letter}`)
    .setMinValues(1)
    .setMaxValues(teamsInGroup.length)
    .addOptions(teamsInGroup.map(t => ({ label: t.team.slice(0, 100), value: String(t.slotNum) })));

  const embed = new EmbedBuilder()
    .setTitle(`🔨 Punish Teams — Group ${letter}`)
    .setColor(0xED4245)
    .setDescription('Select every team whose whole roster should be banned from the server, then confirm.');

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
}

async function handlePunishSelect(interaction) {
  if (!canPunish(interaction)) {
    return interaction.reply({ content: '❌ You need **Manage Server** or **Ban Members** permission to do that.', flags: MessageFlags.Ephemeral });
  }

  const [, letter] = interaction.customId.split(':');
  const store = getGuildStore(interaction.guildId);
  const scrim = store.scrim;

  if (!scrim) {
    return interaction.update({ content: '❌ No scrim is set up right now.', embeds: [], components: [] });
  }

  const botMember = interaction.guild.members.me;
  if (!botMember.permissions.has('ManageRoles')) {
    return interaction.update({ content: '❌ I need the **Manage Roles** permission to punish teams.', embeds: [], components: [] });
  }

  // Giving these roles per-account can take longer than the 3-second
  // interaction ack window, so acknowledge first and edit once it's done.
  await interaction.deferUpdate();

  let scrimsBanRole;
  try {
    scrimsBanRole = await getOrCreateScrimsBanRole(interaction, store);
  } catch (err) {
    return interaction.editReply({ content: `❌ Couldn't create/find the **${SCRIMS_BAN_ROLE_NAME}** role: ${err.message}`, embeds: [], components: [] });
  }

  if (scrimsBanRole.position >= botMember.roles.highest.position) {
    return interaction.editReply({ content: `❌ My highest role is below **${scrimsBanRole.name}** — move my role above it so I can assign it.`, embeds: [], components: [] });
  }

  if (!store.settings.scrimsBans) store.settings.scrimsBans = {};
  const registeredRoleId = store.settings.registeredRoleId;
  const groupRoleId = (store.settings.groupRoles || {})[letter];
  const expiresAt = Date.now() + SCRIMS_BAN_DURATION_MS;

  const punished = [];
  const failed = [];
  const punishedTeams = [];
  const logEntries = []; // one per team: { team, ownerId }

  for (const slotNumStr of interaction.values) {
    const slotNum = parseInt(slotNumStr, 10);
    const slot = scrim.slots[slotNum];
    if (!slot) continue;

    // Punish the owner plus every playing-lineup Discord account on file for
    // this team. Teams registered before selectedPlayerIds started being
    // saved on the slot will only have the owner to go on.
    const idsToBan = [...new Set([slot.userId, ...(slot.selectedPlayerIds || [])])];

    for (const userId of idsToBan) {
      try {
        const member = await interaction.guild.members.fetch(userId);
        await member.roles.add(scrimsBanRole.id);
        if (registeredRoleId && member.roles.cache.has(registeredRoleId)) await member.roles.remove(registeredRoleId);
        if (groupRoleId && member.roles.cache.has(groupRoleId)) await member.roles.remove(groupRoleId);
        store.settings.scrimsBans[userId] = expiresAt;
        punished.push(userId);
      } catch (err) {
        failed.push(userId);
      }
    }

    punishedTeams.push(slot.team);
    logEntries.push({ team: slot.team, ownerId: slot.userId });
    delete scrim.slots[slotNum];
  }

  saveGuildStore(interaction.guildId, store);
  await refreshLivePanel(interaction.client, interaction.guildId);
  await refreshGroupSlotList(interaction.client, interaction.guildId, letter);
  await postPunishmentLog(interaction, store, letter, logEntries, expiresAt);

  const expiryStamp = `<t:${Math.floor(expiresAt / 1000)}:R>`;
  const summary =
    `🔨 Punished **${punishedTeams.join(', ') || 'no teams'}** — gave **${SCRIMS_BAN_ROLE_NAME}** to **${punished.length}** account(s). ` +
    `They can't register again until it lifts automatically ${expiryStamp}.` +
    (failed.length ? `\n⚠️ Failed for ${failed.length}: ${failed.map(id => `<@${id}>`).join(', ')} (left the server, or I'm missing permissions).` : '');

  await interaction.editReply({ content: summary, embeds: [], components: [] });
}

// Posts a staff-facing summary of who got punished to the shared log
// channel — team, owner, group, and when the ban lifts. Never throws — a
// missing channel or missing permissions shouldn't block the punishment
// itself, which has already happened by the time this runs.
async function postPunishmentLog(interaction, store, groupLetter, entries, expiresAt) {
  if (!entries.length) return;

  const logChannel = await resolveLogChannel(interaction.guild, store);
  if (!logChannel) return;

  const lines = entries.map(e => `• **${e.team}** — Owner <@${e.ownerId}>`).join('\n');
  const embed = new EmbedBuilder()
    .setTitle(`🔨 Teams Punished — ${groupDisplayName(groupLetter)}`)
    .setColor(0xED4245)
    .setDescription(
      `${lines}\n\n` +
      `**${SCRIMS_BAN_ROLE_NAME}** given — registration blocked until <t:${Math.floor(expiresAt / 1000)}:F> (<t:${Math.floor(expiresAt / 1000)}:R>).\n` +
      `Punished by <@${interaction.user.id}>`
    )
    .setTimestamp();

  try {
    await logChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Failed to post punishment to log channel:', err);
  }
}

module.exports = {
  buildPunishSelectPayload, handlePunishSelect, getScrimsBanExpiry, startScrimsBanExpiry, SCRIMS_BAN_ROLE_NAME,
};
