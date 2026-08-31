const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'help',
  aliases: ['commands', 'cmds'],
  description: 'Show every prefix command and what it does',
  adminOnly: false,

  async execute(message) {
    const prefix = process.env.PREFIX || '!';

    // client.prefixCommands has each command registered once per name AND
    // once per alias (so lookups are O(1)) — dedupe back down to the
    // unique command objects before listing.
    const unique = [...new Set(message.client.prefixCommands.values())]
      .sort((a, b) => a.name.localeCompare(b.name));

    const embed = new EmbedBuilder()
      .setTitle('📖 Prefix Commands')
      .setColor(0x5865F2)
      .setDescription(`**${unique.length}** command${unique.length === 1 ? '' : 's'} available. 🔒 = requires **Manage Server**.`);

    for (const cmd of unique) {
      const aliasText = cmd.aliases && cmd.aliases.length
        ? ` (alias: ${cmd.aliases.map(a => `\`${prefix}${a}\``).join(', ')})`
        : '';
      embed.addFields({
        name: `${cmd.adminOnly ? '🔒 ' : ''}${prefix}${cmd.name}${aliasText}`,
        value: cmd.description || 'No description provided.',
      });
    }

    await message.channel.send({ embeds: [embed] });
  },
};
