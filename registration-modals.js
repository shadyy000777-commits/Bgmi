const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

// Discord caps modals at 5 text inputs, and we need 11 fields total
// (team name, owner name, whatsapp, + 4 players x [ign, uid]), so the
// form is split across 3 modals shown back-to-back: 5 + 4 + 2 fields.

function row(input) {
  return new ActionRowBuilder().addComponents(input);
}

function buildStep1Modal() {
  const modal = new ModalBuilder().setCustomId('scrim_reg_step1').setTitle('Team Registration - Step 1/3');

  const team = new TextInputBuilder()
    .setCustomId('team_name').setLabel('Team Name')
    .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50);

  const owner = new TextInputBuilder()
    .setCustomId('owner_name').setLabel('Team Owner Full Name')
    .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60);

  const whatsapp = new TextInputBuilder()
    .setCustomId('whatsapp').setLabel('WhatsApp Contact Number')
    .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(15)
    .setPlaceholder('e.g. 919876543210');

  const p1ign = new TextInputBuilder()
    .setCustomId('p1_ign').setLabel('Player 1 - In-Game Name')
    .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(30);

  const p1uid = new TextInputBuilder()
    .setCustomId('p1_uid').setLabel('Player 1 - Game UID')
    .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(15)
    .setPlaceholder('Numbers only, e.g. 5123456789');

  modal.addComponents(row(team), row(owner), row(whatsapp), row(p1ign), row(p1uid));
  return modal;
}

function buildStep2Modal() {
  const modal = new ModalBuilder().setCustomId('scrim_reg_step2').setTitle('Team Registration - Step 2/3');

  const p2ign = new TextInputBuilder()
    .setCustomId('p2_ign').setLabel('Player 2 - In-Game Name')
    .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(30);

  const p2uid = new TextInputBuilder()
    .setCustomId('p2_uid').setLabel('Player 2 - Game UID')
    .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(15);

  const p3ign = new TextInputBuilder()
    .setCustomId('p3_ign').setLabel('Player 3 - In-Game Name')
    .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(30);

  const p3uid = new TextInputBuilder()
    .setCustomId('p3_uid').setLabel('Player 3 - Game UID')
    .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(15);

  modal.addComponents(row(p2ign), row(p2uid), row(p3ign), row(p3uid));
  return modal;
}

function buildStep3Modal() {
  const modal = new ModalBuilder().setCustomId('scrim_reg_step3').setTitle('Team Registration - Step 3/3');

  const p4ign = new TextInputBuilder()
    .setCustomId('p4_ign').setLabel('Player 4 - In-Game Name')
    .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(30);

  const p4uid = new TextInputBuilder()
    .setCustomId('p4_uid').setLabel('Player 4 - Game UID')
    .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(15);

  modal.addComponents(row(p4ign), row(p4uid));
  return modal;
}

module.exports = { buildStep1Modal, buildStep2Modal, buildStep3Modal };
