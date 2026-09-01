const {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, PermissionFlagsBits, MessageFlags,
} = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');
const { slotRangeForGroup } = require('./group-schedule');
const { refreshLivePanel } = require('./live-panel-handlers');

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

  // Banning several accounts per team can take longer than the 3-second
  // interaction ack window, so acknowledge first and edit once it's done.
  await interaction.deferUpdate();

  const banned = [];
  const failed = [];
  const punishedTeams = [];

  for (const slotNumStr of interaction.values) {
    const slotNum = parseInt(slotNumStr, 10);
    const slot = scrim.slots[slotNum];
    if (!slot) continue;

    // Ban the owner plus every playing-lineup Discord account on file for
    // this team. Teams registered before selectedPlayerIds started being
    // saved on the slot will only have the owner to go on.
    const idsToBan = [...new Set([slot.userId, ...(slot.selectedPlayerIds || [])])];

    for (const userId of idsToBan) {
      try {
        await interaction.guild.bans.create(userId, { reason: `Punished with team "${slot.team}" (Group ${letter})` });
        banned.push(userId);
        if (!store.settings.punishments) store.settings.punishments = {};
        store.settings.punishments[userId] = { eventType: 'scrim', team: slot.team, group: letter, bannedAt: Date.now() };
      } catch (err) {
        failed.push(userId);
      }
    }

    punishedTeams.push(slot.team);
    delete scrim.slots[slotNum];
  }

  saveGuildStore(interaction.guildId, store);
  await refreshLivePanel(interaction.client, interaction.guildId);

  const summary =
    `🔨 Punished **${punishedTeams.join(', ') || 'no teams'}** — banned **${banned.length}** account(s).` +
    (failed.length ? `\n⚠️ Failed to ban ${failed.length}: ${failed.map(id => `<@${id}>`).join(', ')} (already banned, left the server, or I'm missing **Ban Members**).` : '');

  await interaction.editReply({ content: summary, embeds: [], components: [] });
}

module.exports = { buildPunishSelectPayload, handlePunishSelect };
