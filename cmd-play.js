const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { addAndPlay } = require('./music-manager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song in your voice channel from a YouTube link')
    .addStringOption(opt =>
      opt.setName('songurl')
        .setDescription('A YouTube video URL')
        .setRequired(true)),

  async execute(interaction) {
    const voiceChannel = interaction.member.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({
        content: '❌ You need to be in a voice channel first — join one, then run `/play` again.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const permissions = voiceChannel.permissionsFor(interaction.guild.members.me);
    if (!permissions?.has(['Connect', 'Speak'])) {
      return interaction.reply({
        content: `❌ I don't have permission to join/speak in ${voiceChannel}. Ask an admin to grant Connect + Speak there.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const url = interaction.options.getString('songurl').trim();

    await interaction.deferReply();

    try {
      const result = await addAndPlay({
        guildId: interaction.guildId,
        voiceChannel,
        textChannel: interaction.channel,
        url,
        requestedBy: interaction.member.displayName,
        adapterCreator: interaction.guild.voiceAdapterCreator,
      });

      if (result.position === 1) {
        await interaction.editReply(`🎶 Now playing: **${result.title}**`);
      } else {
        await interaction.editReply(`✅ Added to queue at position ${result.position}: **${result.title}**`);
      }
    } catch (err) {
      console.error('[cmd-play] Failed to play:', err);
      await interaction.editReply(`❌ Couldn't play that link: ${err.message || 'unknown error'}`);
    }
  },
};
