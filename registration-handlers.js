const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');
const { startPending, getPending, updatePending, clearPending } = require('./pending-registrations');
const { buildStep1Modal, buildStep2Modal, buildStep3Modal } = require('./registration-modals');
const { getScrimsBanExpiry } = require('./punish-handlers');

const WHATSAPP_RE = /^\+?[0-9]{7,15}$/;
const UID_RE = /^[0-9]{5,12}$/;

const RESTART_HINT = 'Click **Register Team** again to restart — no partial data is saved.';

function continueRow(customId, label) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(customId)
      .setLabel(label)
      .setStyle(ButtonStyle.Primary)
    );
}

// --- Step 0: "Register Team" button pressed ---
async function handleRegisterButton(interaction) {
  const store = getGuildStore(interaction.guildId);
  const scrim = store.scrim;

  if (!scrim) {
    return interaction.reply({ content: '❌ No scrim is set up right now.', flags: MessageFlags.Ephemeral });
  }

  const banExpiry = getScrimsBanExpiry(store, interaction.user.id);
  if (banExpiry) {
    saveGuildStore(interaction.guildId, store);
    return interaction.reply({
      content: `❌ You're currently under a **Scrims Ban** and can't register. It lifts automatically <t:${Math.floor(banExpiry / 1000)}:R>.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const already = Object.values(scrim.slots).find(s => s.userId === interaction.user.id);
  if (already) {
    return interaction.reply({
      content: `❌ You've already registered team **${already.team}** in slot **${already.slotNumber}**.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  startPending(interaction.user.id, interaction.guildId);
  await interaction.showModal(buildStep1Modal());
}

// --- Step 1/3 submitted: team name, owner, whatsapp, player 1 ---
async function handleStep1Submit(interaction) {
  const team_name = interaction.fields.getTextInputValue('team_name').trim();
  const owner_name = interaction.fields.getTextInputValue('owner_name').trim();
  const whatsapp = interaction.fields.getTextInputValue('whatsapp').trim();
  const p1_ign = interaction.fields.getTextInputValue('p1_ign').trim();
  const p1_uid = interaction.fields.getTextInputValue('p1_uid').trim();

  if (!WHATSAPP_RE.test(whatsapp)) {
    clearPending(interaction.user.id);
    return interaction.reply({
      content: `❌ That WhatsApp number doesn't look valid (digits only, 7-15 digits, optional leading +). ${RESTART_HINT}`,
      flags: MessageFlags.Ephemeral,
    });
  }
  if (!UID_RE.test(p1_uid)) {
    clearPending(interaction.user.id);
    return interaction.reply({
      content: `❌ Player 1's Game UID must be numbers only (5-12 digits). ${RESTART_HINT}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  updatePending(interaction.user.id, { team_name, owner_name, whatsapp, p1_ign, p1_uid });
  await interaction.reply({
    content: '✅ Step 1 saved. Continue to enter Player 2 and Player 3 details.',
    components: [continueRow('scrim_register_continue_2', 'Continue to Players 2 & 3')],
    flags: MessageFlags.Ephemeral,
  });
}

// Modal submissions cannot reliably open the next modal directly on every Discord client.
// Use an explicit component interaction so the next modal always opens.
async function handleStep2Button(interaction) {
  if (!getPending(interaction.user.id)) {
    return interaction.reply({
      content: `❌ Your registration session expired or was interrupted. ${RESTART_HINT}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.showModal(buildStep2Modal());
}

// --- Step 2/3 submitted: players 2 and 3 ---
async function handleStep2Submit(interaction) {
  const pending = getPending(interaction.user.id);
  if (!pending) {
    return interaction.reply({
      content: `❌ Your registration session expired or was interrupted. ${RESTART_HINT}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const p2_ign = interaction.fields.getTextInputValue('p2_ign').trim();
  const p2_uid = interaction.fields.getTextInputValue('p2_uid').trim();
  const p3_ign = interaction.fields.getTextInputValue('p3_ign').trim();
  const p3_uid = interaction.fields.getTextInputValue('p3_uid').trim();

  for (const [label, uid] of [['Player 2', p2_uid], ['Player 3', p3_uid]]) {
    if (!UID_RE.test(uid)) {
      clearPending(interaction.user.id);
      return interaction.reply({
        content: `❌ ${label}'s Game UID must be numbers only (5-12 digits). ${RESTART_HINT}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  updatePending(interaction.user.id, { p2_ign, p2_uid, p3_ign, p3_uid });
  await interaction.reply({
    content: '✅ Step 2 saved. Continue to enter Player 4 details.',
    components: [continueRow('scrim_register_continue_3', 'Continue to Player 4')],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleStep3Button(interaction) {
  if (!getPending(interaction.user.id)) {
    return interaction.reply({
      content: `❌ Your registration session expired or was interrupted. ${RESTART_HINT}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.showModal(buildStep3Modal());
}

// --- Step 3/3 submitted: player 4 -> finalize and register ---
async function handleStep3Submit(interaction) {
  const pendingEntry = getPending(interaction.user.id);
  if (!pendingEntry) {
    return interaction.reply({
      content: `❌ Your registration session expired or was interrupted. ${RESTART_HINT}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const p4_ign = interaction.fields.getTextInputValue('p4_ign').trim();
  const p4_uid = interaction.fields.getTextInputValue('p4_uid').trim();

  if (!UID_RE.test(p4_uid)) {
    clearPending(interaction.user.id);
    return interaction.reply({
      content: `❌ Player 4's Game UID must be numbers only (5-12 digits). ${RESTART_HINT}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const data = { ...pendingEntry.data, p4_ign, p4_uid };

  // Belt-and-suspenders: every field is `required` on its modal, so this
  // should never actually be missing anything — but if a step was somehow
  // skipped, refuse to register a half-filled team.
  const requiredFields = [
    'team_name', 'owner_name', 'whatsapp',
    'p1_ign', 'p1_uid', 'p2_ign', 'p2_uid', 'p3_ign', 'p3_uid', 'p4_ign', 'p4_uid',
  ];
  const missing = requiredFields.filter(f => !data[f]);
  if (missing.length) {
    clearPending(interaction.user.id);
    return interaction.reply({
      content: `❌ Registration incomplete — some details were missing. ${RESTART_HINT}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const store = getGuildStore(interaction.guildId);
  const scrim = store.scrim;

  if (!scrim) {
    clearPending(interaction.user.id);
    return interaction.reply({ content: '❌ The scrim was deleted while you were filling out the form.', flags: MessageFlags.Ephemeral });
  }

  const dupe = Object.values(scrim.slots).find(
    s => s.userId === interaction.user.id || s.team.toLowerCase() === data.team_name.toLowerCase()
  );
  if (dupe) {
    clearPending(interaction.user.id);
    return interaction.reply({
      content: `❌ You or a team named **${data.team_name}** is already registered in slot **${dupe.slotNumber}**.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  let assigned = null;
  for (let i = 1; i <= scrim.totalSlots; i++) {
    if (!scrim.slots[i]) { assigned = i; break; }
  }
  if (assigned === null) {
    clearPending(interaction.user.id);
    return interaction.reply({ content: '❌ Sorry, all slots are full.', flags: MessageFlags.Ephemeral });
  }

  scrim.slots[assigned] = {
    team: data.team_name,
    ownerName: data.owner_name,
    whatsapp: data.whatsapp,
    players: [
      `${data.p1_ign} (${data.p1_uid})`,
      `${data.p2_ign} (${data.p2_uid})`,
      `${data.p3_ign} (${data.p3_uid})`,
      `${data.p4_ign} (${data.p4_uid})`,
    ],
    userId: interaction.user.id,
    registeredAt: new Date().toISOString(),
    slotNumber: assigned,
  };
  saveGuildStore(interaction.guildId, store);
  clearPending(interaction.user.id);

  await interaction.reply({
    content:
      `✅ **${data.team_name}** registered! You've been allotted **Slot ${assigned}**.\n` +
      `Owner: ${data.owner_name} | WhatsApp: ${data.whatsapp}`,
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = {
  handleRegisterButton,
  handleStep1Submit,
  handleStep2Button,
  handleStep2Submit,
  handleStep3Button,
  handleStep3Submit,
};
