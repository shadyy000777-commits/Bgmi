const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags,
  UserSelectMenuBuilder,
} = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');
const { startPending, getPending, updatePending, clearPending } = require('./pending-verifications');
const { buildVerifyStep1Modal, buildVerifyStep2Modal, buildVerifyStep3Modal } = require('./verification-modals');
const { resolveLogChannel } = require('./log-channel');

const WHATSAPP_RE = /^\+?[0-9]{7,15}$/;
const UID_RE = /^[0-9]{5,12}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// "IGN - UID" — captures everything up to the last " - " as the name, and
// requires the trailing part to look like a UID (digits only).
const P5_COMBINED_RE = /^(.+?)\s*-\s*([0-9]{5,12})$/;

const RESTART_HINT = 'Click **Verify** again to restart — no partial data is saved.';

function continueRow(customId, label) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(customId)
      .setLabel(label)
      .setStyle(ButtonStyle.Primary)
  );
}

// Discord doesn't let a bot write custom error text inside a modal itself —
// the closest real equivalent: keep whatever they already typed, show the
// error as a normal reply, and give them a button that reopens the SAME
// modal pre-filled with their last attempt, so they only need to fix the
// one wrong field instead of retyping everything.
function retryRow(customId, label) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(customId)
      .setLabel(label)
      .setStyle(ButtonStyle.Danger)
  );
}

// Mandatory picker shown after all 5 players' details are entered: the team
// owner picks 4 real Discord members from the server (Discord's native
// member picker — search, avatars, the works) as the confirmed playing
// lineup. These are the accounts that get @mentioned in the verification
// log post. This is separate from the 5 typed IGN/UID entries above, since
// a typed IGN doesn't necessarily map to a specific Discord account.
function buildPlayerSelectRow() {
  const menu = new UserSelectMenuBuilder()
    .setCustomId('verify_select_players')
    .setPlaceholder('Select the 4 players who will play')
    .setMinValues(4)
    .setMaxValues(4);

  return new ActionRowBuilder().addComponents(menu);
}

function buildVerifiedEmbed(data, isEdit) {
  const playerFields = [1, 2, 3, 4, 5]
    .filter(n => n < 5 || data.p5_ign) // Player 5 is optional — omit the field entirely if not filled in
    .map(n => {
      const key = `p${n}`;
      return { name: `Player ${n}`, value: `${data[`${key}_ign`]} (${data[`${key}_uid`]})` };
    });

  const lineupLine = (data.selectedPlayerIds || []).map(id => `<@${id}>`).join(' ') || '_not selected_';

  return new EmbedBuilder()
    .setTitle(isEdit ? `✏️ ${data.team_name} — Details Updated` : `✅ ${data.team_name} — Verified`)
    .setColor(isEdit ? 0x5865F2 : 0x57F287)
    .addFields(
      { name: 'Team Name', value: data.team_name, inline: true },
      { name: 'Team Owner Full Name', value: data.owner_name, inline: true },
      { name: 'City', value: data.city, inline: true },
      { name: 'WhatsApp Contact Number', value: data.whatsapp, inline: true },
      { name: 'Team Owner Email', value: data.owner_email, inline: true },
      ...playerFields,
      { name: 'Playing Lineup', value: lineupLine },
      { name: 'Team Registered Date', value: new Date(data.registeredDate).toUTCString() },
    );
}

// Posted to the PRIVATE channel configured via /set-private-verify-channel
// — mirrors the "OQ Team Registration Confirmed" card style (team number
// header, divider lines, per-player IGN/UID blocks, substitute section)
// but built from verification data only, since verification happens
// before a team has a scrim slot/group/match schedule to show. Player 5
// (if filled in) is treated as the substitute, same as the registration
// flow already does.
function buildPrivateVerifiedLogEmbed(data, teamNumber, ownerId, isEdit) {
  const playerLines = [1, 2, 3, 4]
    .map(n => `**PLAYER ${n}**\nIGN :- ${data[`p${n}_ign`]}\nUID :- ${data[`p${n}_uid`]}`)
    .join('\n\n');

  const substituteLine = data.p5_ign
    ? `IGN :- ${data.p5_ign}\nUID :- ${data.p5_uid}`
    : 'NO SUBSTITUTE SELECTED';

  const lineupLine = (data.selectedPlayerIds || []).map(id => `<@${id}>`).join(' ') || '_not selected_';

  return new EmbedBuilder()
    .setTitle(isEdit ? '🔄 Team Verification Updated' : '✅ Team Verification Confirmed')
    .setColor(isEdit ? 0x5865F2 : 0x57F287)
    .setDescription(
      `**TEAM NUMBER**\n#${teamNumber}\n\n` +
      `━━━━━━━━━━━━━━\n\n` +
      `👑 **OWNER**\n<@${ownerId}>\n\n` +
      `━━━━━━━━━━━━━━\n\n` +
      `🏳️ **TEAM NAME**\n${data.team_name}\n\n` +
      `━━━━━━━━━━━━━━\n\n` +
      `📍 **CITY**\n${data.city}\n\n` +
      `━━━━━━━━━━━━━━\n\n` +
      `📱 **WHATSAPP**\n${data.whatsapp}\n\n` +
      `✉️ **EMAIL**\n${data.owner_email}\n\n` +
      `━━━━━━━━━━━━━━\n\n` +
      `🧑‍🤝‍🧑 **PLAYERS**\n${playerLines}\n\n` +
      `━━━━━━━━━━━━━━\n\n` +
      `🔁 **SUBSTITUTE**\n${substituteLine}\n\n` +
      `━━━━━━━━━━━━━━\n\n` +
      `👥 **PLAYING LINEUP**\n${lineupLine}`
    )
    .setFooter({ text: isEdit ? 'Updated' : 'Best of luck 👊 for your matches!!' })
    .setTimestamp();
}

// Posted to the PUBLIC channel configured via /set-verify-channel — the
// full detail card (team number, owner mention, city, WhatsApp, email,
// per-player IGN/UID, playing lineup). Also reused by !team
// (pcmd-team.js) for the on-demand admin lookup — mirrors the "Team
// Confirmed" card style rather than the plain field grid used for the
// player's own ephemeral confirmation.
function buildVerifiedLogEmbed(data, teamNumber, ownerId, isEdit) {
  const playerLines = [1, 2, 3, 4, 5]
    .filter(n => n < 5 || data.p5_ign) // Player 5 is optional — omit the line entirely if not filled in
    .map(n => {
      const key = `p${n}`;
      return `<a:emoji_1:1543489357053427822> \`${data[`${key}_ign`]}\` / ${data[`${key}_uid`]}`;
    })
    .join('\n');

  const lineupLine = (data.selectedPlayerIds || []).map(id => `<@${id}>`).join(' ') || '_not selected_';

  return new EmbedBuilder()
    .setTitle(isEdit ? '<:emoji_192:1545641134720684032> TEAM VERIFICATION CONFIRMED' : '<a:emoji_14:1544290922043543552> TEAM VERIFICATION — Team Confirmed')
    .setColor(isEdit ? 0x5865F2 : 0xF5A623)
    .setDescription(
      `<:emoji_8:1543560280729194526> ${teamNumber} : **TEAM ${data.team_name}**\n` +
      `<:PrXOwner:1543181913827582032> Owner - <@${ownerId}>\n` +
      `<a:emoji_9:1543560454331441242> City - ${data.city}\n\n` +
      `<a:emoji_2:1543555537235476490> **Players (IGN/UID)**\n${playerLines}\n\n` +
      `<:emoji_193:1545643032097980476> WhatsApp: ${data.whatsapp} | <:emoji_194:1545643354216464384> ${data.owner_email}\n\n` +
      `<a:emoji_189:1545523471746990092> **Playing Lineup -** ${lineupLine}`
    )
    .setFooter({
      text: isEdit
        ? `Updated ${new Date().toUTCString()}`
        : `Registered ${new Date(data.registeredDate).toUTCString()}`,
    });
}

// --- Step 0a: "Verify" button pressed (fresh verification) ---
async function handleVerifyButton(interaction) {
  const store = getGuildStore(interaction.guildId);
  const existing = store.verifications && store.verifications[interaction.user.id];

  if (existing) {
    return interaction.reply({
      content: `❌ You've already verified team **${existing.team_name}**. Use the **Edit** button to update your details instead.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  startPending(interaction.user.id, interaction.guildId, 'create');
  await interaction.showModal(buildVerifyStep1Modal());
}

// --- Step 0b: "Edit" button pressed (update an existing verification) ---
async function handleVerifyEditButton(interaction) {
  const store = getGuildStore(interaction.guildId);
  const existing = store.verifications && store.verifications[interaction.user.id];

  if (!existing) {
    return interaction.reply({
      content: "❌ You haven't verified yet — click **Verify** first.",
      flags: MessageFlags.Ephemeral,
    });
  }

  startPending(interaction.user.id, interaction.guildId, 'edit', existing);
  await interaction.showModal(buildVerifyStep1Modal(existing));
}

// --- Step 1/3 submitted: team name, owner, whatsapp, email, city ---
async function handleVerifyStep1Submit(interaction) {
  const team_name = interaction.fields.getTextInputValue('team_name').trim();
  const owner_name = interaction.fields.getTextInputValue('owner_name').trim();
  const whatsapp = interaction.fields.getTextInputValue('whatsapp').trim();
  const owner_email = interaction.fields.getTextInputValue('owner_email').trim();
  const city = interaction.fields.getTextInputValue('city').trim();

  // Keep whatever they typed (valid or not) so a retry can prefill it —
  // this needs a pending entry to exist even on the very first step.
  if (!getPending(interaction.user.id)) startPending(interaction.user.id, interaction.guildId, 'create');
  updatePending(interaction.user.id, { team_name, owner_name, whatsapp, owner_email, city });

  if (!WHATSAPP_RE.test(whatsapp)) {
    return interaction.reply({
      content: "❌ That WhatsApp number doesn't look valid (digits only, 7-15 digits, optional leading +). Tap **Try Again** to fix it — your other answers are kept.",
      components: [retryRow('verify_retry_step1', 'Try Again')],
      flags: MessageFlags.Ephemeral,
    });
  }
  if (!EMAIL_RE.test(owner_email)) {
    return interaction.reply({
      content: "❌ That email address doesn't look valid. Tap **Try Again** to fix it — your other answers are kept.",
      components: [retryRow('verify_retry_step1', 'Try Again')],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.reply({
    content: '✅ Step 1 saved. Continue to enter Player 1 and Player 2 details.',
    components: [continueRow('verify_continue_2', 'Continue to Players 1 & 2')],
    flags: MessageFlags.Ephemeral,
  });
}

// "Try Again" after a Step 1 validation error — reopens Step 1's modal
// prefilled with everything they already typed, including the bad field.
async function handleVerifyRetryStep1(interaction) {
  const pending = getPending(interaction.user.id);
  if (!pending) {
    return interaction.reply({
      content: `❌ Your verification session expired or was interrupted. ${RESTART_HINT}`,
      flags: MessageFlags.Ephemeral,
    });
  }
  await interaction.showModal(buildVerifyStep1Modal(pending.data));
}

// Modal submissions cannot reliably open the next modal directly on every Discord client.
// Use an explicit component interaction so the next modal always opens.
async function handleVerifyStep2Button(interaction) {
  const pending = getPending(interaction.user.id);
  if (!pending) {
    return interaction.reply({
      content: `❌ Your verification session expired or was interrupted. ${RESTART_HINT}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.showModal(buildVerifyStep2Modal(pending.original));
}

// --- Step 2/3 submitted: player 1 (ign+uid), player 2 (ign+uid), player 3 ign ---
async function handleVerifyStep2Submit(interaction) {
  const pending = getPending(interaction.user.id);
  if (!pending) {
    return interaction.reply({
      content: `❌ Your verification session expired or was interrupted. ${RESTART_HINT}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const p1_ign = interaction.fields.getTextInputValue('p1_ign').trim();
  const p1_uid = interaction.fields.getTextInputValue('p1_uid').trim();
  const p2_ign = interaction.fields.getTextInputValue('p2_ign').trim();
  const p2_uid = interaction.fields.getTextInputValue('p2_uid').trim();

  // Keep whatever they typed (valid or not) so a retry can prefill it.
  updatePending(interaction.user.id, { p1_ign, p1_uid, p2_ign, p2_uid });

  for (const [label, uid] of [['Player 1', p1_uid], ['Player 2', p2_uid]]) {
    if (!UID_RE.test(uid)) {
      return interaction.reply({
        content: `❌ ${label}'s Game UID must be numbers only (5-12 digits). Tap **Try Again** to fix it — your other answers are kept.`,
        components: [retryRow('verify_retry_step2', 'Try Again')],
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  await interaction.reply({
    content: '✅ Step 2 saved. Continue to enter Player 3, Player 4 and Player 5 details.',
    components: [continueRow('verify_continue_3', 'Continue to Player 3, 4 & 5')],
    flags: MessageFlags.Ephemeral,
  });
}

// "Try Again" after a Step 2 validation error — reopens Step 2's modal
// prefilled with everything they already typed, including the bad field.
async function handleVerifyRetryStep2(interaction) {
  const pending = getPending(interaction.user.id);
  if (!pending) {
    return interaction.reply({
      content: `❌ Your verification session expired or was interrupted. ${RESTART_HINT}`,
      flags: MessageFlags.Ephemeral,
    });
  }
  await interaction.showModal(buildVerifyStep2Modal(pending.data));
}

async function handleVerifyStep3Button(interaction) {
  const pending = getPending(interaction.user.id);
  if (!pending) {
    return interaction.reply({
      content: `❌ Your verification session expired or was interrupted. ${RESTART_HINT}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.showModal(buildVerifyStep3Modal(pending.original));
}

// --- Step 3/3 submitted: player 3 uid, players 4 and 5 -> ask which 4 play ---
async function handleVerifyStep3Submit(interaction) {
  const pendingEntry = getPending(interaction.user.id);
  if (!pendingEntry) {
    return interaction.reply({
      content: `❌ Your verification session expired or was interrupted. ${RESTART_HINT}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const p3_ign = interaction.fields.getTextInputValue('p3_ign').trim();
  const p3_uid = interaction.fields.getTextInputValue('p3_uid').trim();
  const p4_ign = interaction.fields.getTextInputValue('p4_ign').trim();
  const p4_uid = interaction.fields.getTextInputValue('p4_uid').trim();
  const p5_combined = interaction.fields.getTextInputValue('p5_combined').trim();

  // Keep whatever they typed (valid or not) so a retry can prefill it.
  updatePending(interaction.user.id, { p3_ign, p3_uid, p4_ign, p4_uid, p5_combined });

  for (const [label, uid] of [['Player 3', p3_uid], ['Player 4', p4_uid]]) {
    if (!UID_RE.test(uid)) {
      return interaction.reply({
        content: `❌ ${label}'s Game UID must be numbers only (5-12 digits). Tap **Try Again** to fix it — your other answers are kept.`,
        components: [retryRow('verify_retry_step3', 'Try Again')],
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  const p5Match = p5_combined ? P5_COMBINED_RE.exec(p5_combined) : null;
  if (p5_combined && !p5Match) {
    return interaction.reply({
      content: '❌ Player 5 must be in the format **IGN - UID** (e.g. `ProGamer123 - 5123456789`), or left blank if there is no Player 5. Tap **Try Again** to fix it — your other answers are kept.',
      components: [retryRow('verify_retry_step3', 'Try Again')],
      flags: MessageFlags.Ephemeral,
    });
  }
  const p5_ign = p5Match ? p5Match[1].trim() : '';
  const p5_uid = p5Match ? p5Match[2].trim() : '';
  updatePending(interaction.user.id, { p5_ign, p5_uid });

  const entry = getPending(interaction.user.id);

  // Belt-and-suspenders: every field except Player 5 is `required` on its
  // modal, so this should never actually be missing anything — but if a
  // step was somehow skipped, refuse to continue with a half-filled
  // verification. Player 5 is optional and deliberately excluded here.
  const requiredFields = [
    'team_name', 'owner_name', 'whatsapp', 'owner_email', 'city',
    'p1_ign', 'p1_uid', 'p2_ign', 'p2_uid', 'p3_ign', 'p3_uid', 'p4_ign', 'p4_uid',
  ];
  const missing = requiredFields.filter(f => !entry.data[f]);
  if (missing.length) {
    clearPending(interaction.user.id);
    return interaction.reply({
      content: `❌ Verification incomplete — some details were missing. ${RESTART_HINT}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.reply({
    content: '✅ Step 3 saved. Last step — select the **4 players from this server** who will play:',
    components: [buildPlayerSelectRow()],
    flags: MessageFlags.Ephemeral,
  });
}

// "Try Again" after a Step 3 validation error — reopens Step 3's modal
// prefilled with everything they already typed, including the bad field.
async function handleVerifyRetryStep3(interaction) {
  const pending = getPending(interaction.user.id);
  if (!pending) {
    return interaction.reply({
      content: `❌ Your verification session expired or was interrupted. ${RESTART_HINT}`,
      flags: MessageFlags.Ephemeral,
    });
  }
  await interaction.showModal(buildVerifyStep3Modal(pending.data));
}

// Gives the configured "verified" role (set via /set-verify-role), if one
// is configured. Never throws — a missing role, missing permissions, or the
// member having left shouldn't ever block verification itself from
// completing. Mirrors giveRegisteredRole in register-handlers.js.
async function giveVerifiedRole(interaction, store) {
  const roleId = store.settings && store.settings.verifiedRoleId;
  if (!roleId) {
    console.warn(`[verified-role] No verifiedRoleId configured for guild ${interaction.guildId} — run /set-verify-role.`);
    return;
  }

  const role = interaction.guild.roles.cache.get(roleId);
  if (!role) {
    console.error(`[verified-role] Configured role ${roleId} no longer exists in guild ${interaction.guildId} — re-run /set-verify-role.`);
    return;
  }

  const botMember = interaction.guild.members.me;
  if (!botMember.permissions.has('ManageRoles')) {
    console.error(`[verified-role] Bot is missing the "Manage Roles" permission in guild ${interaction.guildId}.`);
    return;
  }
  if (role.position >= botMember.roles.highest.position) {
    console.error(`[verified-role] Bot's highest role is below "${role.name}" (${roleId}) in guild ${interaction.guildId} — move the bot's role above it.`);
    return;
  }

  try {
    const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);
    if (!member.roles.cache.has(roleId)) {
      await member.roles.add(roleId);
    }
  } catch (err) {
    console.error(`[verified-role] Failed to give role ${roleId} to ${interaction.user.id} in guild ${interaction.guildId}: ${err.code ?? ''} ${err.message}`);
  }
}

// --- Final step: pick 4 real Discord members as the playing lineup -> finalize and save verification ---
async function handleVerifyPlayerSelect(interaction) {  const pendingEntry = getPending(interaction.user.id);
  if (!pendingEntry) {
    return interaction.reply({
      content: `❌ Your verification session expired or was interrupted. ${RESTART_HINT}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const data = { ...pendingEntry.data, selectedPlayerIds: interaction.values };

  const store = getGuildStore(interaction.guildId);
  if (!store.verifications) store.verifications = {};
  if (!store.settings) store.settings = {};

  const isEdit = pendingEntry.mode === 'edit';
  const existingRecord = store.verifications[interaction.user.id];

  if (!isEdit && existingRecord) {
    // Belt-and-suspenders: handleVerifyButton already blocks this, but guard
    // against a race (e.g. two rapid submissions) from double-creating.
    clearPending(interaction.user.id);
    return interaction.reply({
      content: `❌ You've already verified team **${existingRecord.team_name}**. Use **Edit** to update your details instead.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  let teamNumber;
  if (isEdit && existingRecord) {
    teamNumber = existingRecord.teamNumber;
    data.registeredDate = existingRecord.registeredDate; // keep original registration date
  } else {
    teamNumber = (store.settings.verifyTeamCounter || 0) + 1;
    store.settings.verifyTeamCounter = teamNumber;
    data.registeredDate = new Date().toISOString();
  }
  data.teamNumber = teamNumber;

  store.verifications[interaction.user.id] = data;
  saveGuildStore(interaction.guildId, store);
  clearPending(interaction.user.id);

  await giveVerifiedRole(interaction, store);

  const verifiedEmbed = buildVerifiedEmbed(data, isEdit);

  const logChannel = await resolveLogChannel(interaction.guild, store, store.settings.verifyLogChannelId);
  if (logChannel) {
    try {
      await logChannel.send({ embeds: [buildVerifiedLogEmbed(data, teamNumber, interaction.user.id, isEdit)] });
    } catch (err) {
      console.error('Failed to post verification to public log channel:', err);
      // Don't block the user's confirmation just because the log post failed
      // (e.g. channel deleted, bot missing permissions).
    }
  }

  // Private-channel card only goes out if one was explicitly configured —
  // no fallback, since silently dumping WhatsApp/email/IGN-UID into a
  // channel nobody meant to be private would defeat the whole point.
  const privateChannelId = store.settings.privateVerifyLogChannelId;
  if (privateChannelId) {
    const privateChannel = interaction.guild.channels.cache.get(privateChannelId);
    if (privateChannel) {
      try {
        await privateChannel.send({ embeds: [buildPrivateVerifiedLogEmbed(data, teamNumber, interaction.user.id, isEdit)] });
      } catch (err) {
        console.error('Failed to post verification to private log channel:', err);
      }
    } else {
      console.error(`[verify-log] Configured privateVerifyLogChannelId ${privateChannelId} no longer exists in guild ${interaction.guildId} — re-run /set-private-verify-channel.`);
    }
  }

  await interaction.update({
    content: null,
    embeds: [verifiedEmbed],
    components: [],
  });
}

module.exports = {
  buildVerifiedLogEmbed,
  handleVerifyButton,
  handleVerifyEditButton,
  handleVerifyStep1Submit,
  handleVerifyRetryStep1,
  handleVerifyStep2Button,
  handleVerifyStep2Submit,
  handleVerifyRetryStep2,
  handleVerifyStep3Button,
  handleVerifyStep3Submit,
  handleVerifyRetryStep3,
  handleVerifyPlayerSelect,
  giveVerifiedRole,
};
