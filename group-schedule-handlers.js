const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, PermissionFlagsBits,
} = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');
const { activeGroupLetters, groupDisplayName, setSchedule, getSchedule } = require('./group-schedule');
const { refreshLivePanel } = require('./live-panel-handlers');

const TIME_RE = /^([1-9]|1[0-2]):([0-5][0-9])$/; // 12-hour clock, no AM/PM (matches, e.g., "2:34")

function padTime(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${minute}`;
}

function buildGroupSchedulePanelPayload(store) {
  const letters = activeGroupLetters(store.scrim ? store.scrim.totalSlots : 0);

  const embed = new EmbedBuilder()
    .setTitle('🗓️ Group Match Schedule')
    .setColor(0x5865F2)
    .setDescription(letters.length
      ? 'Pick a group below to set its match times, start times, and maps.'
      : 'No groups exist yet — set up a scrim with `!scrims` first.');

  if (!letters.length) return { embeds: [embed], components: [] };

  const select = new StringSelectMenuBuilder()
    .setCustomId('group_schedule_select')
    .setPlaceholder('Choose a group to edit')
    .addOptions(letters.map(letter => ({ label: groupDisplayName(letter), value: letter })));

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
}

function buildScheduleModal(letter, store) {
  const existing = getSchedule(store, letter);
  const m1 = existing ? existing.matches[0] : null;
  const m2 = existing ? existing.matches[1] : null;

  return new ModalBuilder()
    .setCustomId(`group_schedule_modal:${letter}`)
    .setTitle(`${groupDisplayName(letter)} Schedule`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('m1idp').setLabel('Match 1 IDP time (e.g. 2:34)').setStyle(TextInputStyle.Short)
          .setValue(m1 ? m1.idp : '').setRequired(true).setMaxLength(5)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('m1start').setLabel('Match 1 Start time (e.g. 2:40)').setStyle(TextInputStyle.Short)
          .setValue(m1 ? m1.start : '').setRequired(true).setMaxLength(5)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('m2idp').setLabel('Match 2 IDP time (e.g. 3:14)').setStyle(TextInputStyle.Short)
          .setValue(m2 ? m2.idp : '').setRequired(true).setMaxLength(5)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('m2start').setLabel('Match 2 Start time (e.g. 3:20)').setStyle(TextInputStyle.Short)
          .setValue(m2 ? m2.start : '').setRequired(true).setMaxLength(5)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('maps').setLabel('Maps (comma-separated, Match 1, Match 2)').setStyle(TextInputStyle.Short)
          .setValue(m1 && m2 ? `${m1.map}, ${m2.map}` : '').setPlaceholder('Erangel, Miramar').setRequired(true).setMaxLength(60)
      ),
    );
}

function hasManageGuild(interaction) {
  return interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
}

async function handleGroupScheduleSelect(interaction) {
  if (!hasManageGuild(interaction)) {
    return interaction.reply({ content: '❌ You need the **Manage Server** permission to do that.', flags: MessageFlags.Ephemeral });
  }
  const store = getGuildStore(interaction.guildId);
  const letter = interaction.values[0];
  return interaction.showModal(buildScheduleModal(letter, store));
}

async function handleGroupScheduleModalSubmit(interaction) {
  const [, letter] = interaction.customId.split(':');
  const store = getGuildStore(interaction.guildId);

  const m1idp = interaction.fields.getTextInputValue('m1idp').trim();
  const m1start = interaction.fields.getTextInputValue('m1start').trim();
  const m2idp = interaction.fields.getTextInputValue('m2idp').trim();
  const m2start = interaction.fields.getTextInputValue('m2start').trim();
  const mapsRaw = interaction.fields.getTextInputValue('maps').trim();

  for (const [label, value] of [['Match 1 IDP', m1idp], ['Match 1 Start', m1start], ['Match 2 IDP', m2idp], ['Match 2 Start', m2start]]) {
    if (!TIME_RE.test(value)) {
      return interaction.reply({ content: `❌ "${value}" isn't a valid time for **${label}**. Use H:MM on a 12-hour clock, e.g. \`2:34\`.`, flags: MessageFlags.Ephemeral });
    }
  }

  const maps = mapsRaw.split(',').map(m => m.trim()).filter(Boolean);
  if (maps.length < 1) {
    return interaction.reply({ content: '❌ Add at least one map.', flags: MessageFlags.Ephemeral });
  }
  const map1 = maps[0];
  const map2 = maps[1] || maps[0];

  const normalize = (t) => { const [h, m] = t.split(':'); return padTime(parseInt(h, 10), m); };

  setSchedule(store, letter, {
    matches: [
      { idp: normalize(m1idp), start: normalize(m1start), map: map1 },
      { idp: normalize(m2idp), start: normalize(m2start), map: map2 },
    ],
  });
  saveGuildStore(interaction.guildId, store);

  await interaction.reply({
    content: `✅ ${groupDisplayName(letter)} schedule updated:\nMatch 1 — IDP ${normalize(m1idp)} PM, Start ${normalize(m1start)} PM, ${map1}\nMatch 2 — IDP ${normalize(m2idp)} PM, Start ${normalize(m2start)} PM, ${map2}`,
    flags: MessageFlags.Ephemeral,
  });

  await refreshLivePanel(interaction.client, interaction.guildId);
}

module.exports = { buildGroupSchedulePanelPayload, handleGroupScheduleSelect, handleGroupScheduleModalSubmit };
