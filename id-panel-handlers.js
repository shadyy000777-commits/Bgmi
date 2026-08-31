const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, ChannelSelectMenuBuilder,
  ChannelType, MessageFlags,
} = require('discord.js');

// Short-lived scratch space bridging the modal submit and the channel-select
// step that follows it (two separate interactions, same user). Entries are
// deleted as soon as they're used or after 5 minutes, whichever comes first.
const pendingRoomDetails = new Map();

function buildIdPanelPayload() {
  const embed = new EmbedBuilder()
    .setTitle('🎮 Room Details Panel')
    .setColor(0x5865F2)
    .setDescription('Click below to send the Room ID, Password and Map to any channel.');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('idpanel_send').setLabel('Send Room Details').setEmoji('📤').setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [row] };
}

function buildRoomDetailsModal() {
  return new ModalBuilder()
    .setCustomId('idpanel_modal')
    .setTitle('Room Details')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('id').setLabel('Room ID').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('password').setLabel('Room Password').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('map').setLabel('Map').setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. Erangel, Miramar, Sanhok, Vikendi').setRequired(true).setMaxLength(50)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('note').setLabel('Extra note (optional)').setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('e.g. Match 1 — be ready in 5 mins').setRequired(false).setMaxLength(300)
      ),
    );
}

async function handleIdPanelButton(interaction) {
  if (interaction.customId !== 'idpanel_send') return;
  await interaction.showModal(buildRoomDetailsModal());
}

async function handleIdPanelModalSubmit(interaction) {
  const roomId = interaction.fields.getTextInputValue('id').trim();
  const password = interaction.fields.getTextInputValue('password').trim();
  const map = interaction.fields.getTextInputValue('map').trim();
  const note = interaction.fields.getTextInputValue('note').trim();

  const key = `${interaction.guildId}:${interaction.user.id}`;
  pendingRoomDetails.set(key, { roomId, password, map, note });
  setTimeout(() => pendingRoomDetails.delete(key), 5 * 60 * 1000);

  const select = new ChannelSelectMenuBuilder()
    .setCustomId('idpanel_channel_select')
    .setPlaceholder('Choose a channel to post this in')
    .addChannelTypes(ChannelType.GuildText);

  await interaction.reply({
    content: '✅ Got the details — now pick a channel to post them in:',
    components: [new ActionRowBuilder().addComponents(select)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleIdPanelChannelSelect(interaction) {
  const key = `${interaction.guildId}:${interaction.user.id}`;
  const pending = pendingRoomDetails.get(key);

  if (!pending) {
    return interaction.update({ content: '❌ That expired — click **Send Room Details** again.', components: [] });
  }

  const channel = interaction.channels.first();
  const me = interaction.guild.members.me;

  if (!channel.permissionsFor(me).has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
    return interaction.update({
      content: `❌ I don't have permission to send embeds in ${channel}. I need **View Channel**, **Send Messages**, and **Embed Links** there.`,
      components: [],
    });
  }

  const embed = new EmbedBuilder()
    .setTitle('🎮 Room Details')
    .setColor(0x57F287)
    .addFields(
      { name: '🆔 Room ID', value: `\`${pending.roomId}\``, inline: true },
      { name: '🔑 Password', value: `\`${pending.password}\``, inline: true },
      { name: '🗺️ Map', value: pending.map, inline: true },
    )
    .setFooter({ text: `Posted by ${interaction.user.tag}` })
    .setTimestamp();

  if (pending.note) embed.setDescription(pending.note);

  try {
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Failed to send room details:', err);
    return interaction.update({ content: `❌ Couldn't send the message to ${channel}. Please check my permissions there.`, components: [] });
  }

  pendingRoomDetails.delete(key);
  await interaction.update({ content: `✅ Room details sent to ${channel}.`, components: [] });
}

module.exports = {
  buildIdPanelPayload,
  handleIdPanelButton,
  handleIdPanelModalSubmit,
  handleIdPanelChannelSelect,
};
