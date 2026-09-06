const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getQueue } = require('./music-manager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the current music queue'),

  async execute(interaction) {
    const queue = getQueue(interaction.guildId);
    if (!queue || !queue.songs.length) {
      return interaction.reply({ content: 'The queue is empty.', flags: MessageFlags.Ephemeral });
    }

    const lines = queue.songs.map((s, i) =>
      i === 0
        ? `▶️ **${s.title}** — requested by ${s.requestedBy} (now playing)`
        : `${i}. ${s.title} — requested by ${s.requestedBy}`
    );

    await interaction.reply({ content: lines.join('\n').slice(0, 1900), flags: MessageFlags.Ephemeral });
  },
};
