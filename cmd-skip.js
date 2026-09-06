const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { skip, getQueue } = require('./music-manager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the currently playing song'),

  async execute(interaction) {
    const queue = getQueue(interaction.guildId);
    if (!queue || !queue.songs.length) {
      return interaction.reply({ content: '❌ Nothing is playing right now.', flags: MessageFlags.Ephemeral });
    }

    const current = queue.songs[0];
    skip(interaction.guildId);
    await interaction.reply(`⏭️ Skipped **${current.title}**.`);
  },
};
