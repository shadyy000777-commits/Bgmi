const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { stop, getQueue } = require('./music-manager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playback, clear the queue, and leave the voice channel'),

  async execute(interaction) {
    const queue = getQueue(interaction.guildId);
    if (!queue) {
      return interaction.reply({ content: '❌ Nothing is playing right now.', flags: MessageFlags.Ephemeral });
    }

    stop(interaction.guildId);
    await interaction.reply('⏹️ Stopped playback and left the voice channel.');
  },
};
