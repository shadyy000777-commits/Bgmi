const {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, PermissionFlagsBits,
} = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');
const { GROUPS_PER_DAY, getScheduleForPosition, setSchedule } = require('./group-schedule');
const { refreshLivePanel } = require('./live-panel-handlers');

const TIME_RE = /^([1-9]|1[0-2]):([0-5][0-9])$/; // 12-hour clock, no AM/PM (matches, e.g., "2:34")

const POSITION_LABELS = ['1st match of the day', '2nd match of the day', '3rd match of the day', '4th match of the day'];

function padTime(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${minute}`;
}

// Only GROUPS_PER_DAY (4) time slots exist — every group reuses one of
// these 4 based on its position in its day-batch, so admins set the
// schedule once per position rather than once per (potentially 1000+)
// individual group.
function buildGroupSchedulePanelPayload(store) {
  const embed = new EmbedBuilder()
    .setTitle('🗓️ Daily Match Schedule')
    .setColor(0x5865F2)
    .setDescription(
      'Every real match day runs the same 4 time slots — set each one below. ' +
      'Whichever 4 groups are up on a given day automatically use these times.'
    );

  const select = new StringSelectMenuBuilder()
    .setCustomId('group_schedule_select')
    .setPlaceholder('Choose a time slot to edit')
    .addOptions(POSITION_LABELS.map((label, position) => ({ label, value: String(position) })));

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
}

function buildScheduleModal(position, store) {
  const existing = getScheduleForPosition(store, position);
  const m1 = existing ? existing.matches[0] : null;
  const m2 = existing ? existing.matches[1] : null;

  return new ModalBuilder()
    .setCustomId(`group_schedule_modal:${position}`)
    .setTitle(`${POSITION_LABELS[position]} Schedule`)
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
  const position = parseInt(interaction.values[0], 10);
  return interaction.showModal(buildScheduleModal(position, store));
}

async function handleGroupScheduleModalSubmit(interaction) {
  const [, positionRaw] = interaction.customId.split(':');
  const position = parseInt(positionRaw, 10);
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

  setSchedule(store, position, {
    matches: [
      { idp: normalize(m1idp), start: normalize(m1start), map: map1 },
      { idp: normalize(m2idp), start: normalize(m2start), map: map2 },
    ],
  });
  saveGuildStore(interaction.guildId, store);

  await interaction.reply({
    content: `✅ ${POSITION_LABELS[position]} schedule updated:\nMatch 1 — IDP ${normalize(m1idp)} PM, Start ${normalize(m1start)} PM, ${map1}\nMatch 2 — IDP ${normalize(m2idp)} PM, Start ${normalize(m2start)} PM, ${map2}`,
    flags: MessageFlags.Ephemeral,
  });

  await refreshLivePanel(interaction.client, interaction.guildId);
}

module.exports = { buildGroupSchedulePanelPayload, handleGroupScheduleSelect, handleGroupScheduleModalSubmit };
