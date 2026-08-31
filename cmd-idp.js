const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('idp')
    .setDescription('Send the Room ID, Password and Map to a channel')
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('Channel to post the room details in')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('id')
        .setDescription('Room ID')
        .setRequired(true)
        .setMaxLength(50))
    .addStringOption(opt =>
      opt.setName('password')
        .setDescription('Room Password')
        .setRequired(true)
        .setMaxLength(50))
    .addStringOption(opt =>
      opt.setName('map')
        .setDescription('Map name (e.g. Erangel, Miramar, Sanhok, Vikendi)')
        .setRequired(true)
        .setMaxLength(50))
    .addStringOption(opt =>
      opt.setName('message')
        .setDescription('Extra note to include (e.g. "Match 1 — be ready in 5 mins")')
        .setRequired(false)
        .setMaxLength(300))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    const roomId = interaction.options.getString('id').trim();
    const password = interaction.options.getString('password').trim();
    const map = interaction.options.getString('map').trim();
    const note = interaction.options.getString('message');

    // Make sure the bot can actually post there before we tell the mod it worked.
    const me = interaction.guild.members.me;
    if (!channel.permissionsFor(me).has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
      return interaction.reply({
        content: `❌ I don't have permission to send embeds in ${channel}. I need **View Channel**, **Send Messages**, and **Embed Links** there.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const embed = new EmbedBuilder()
      .setTitle('🎮 Room Details')
      .setColor(0x57F287)
      .addFields(
        { name: '🆔 Room ID', value: `\`${roomId}\``, inline: true },
        { name: '🔑 Password', value: `\`${password}\``, inline: true },
        { name: '🗺️ Map', value: map, inline: true },
      )
      .setFooter({ text: `Posted by ${interaction.user.tag}` })
      .setTimestamp();

    if (note) {
      embed.setDescription(note);
    }

    try {
      await channel.send({ embeds: [embed] });
    } catch (err) {
      console.error('Failed to send room details:', err);
      return interaction.reply({
        content: `❌ Couldn't send the message to ${channel}. Please check my permissions there.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.reply({
      content: `✅ Room details sent to ${channel}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
