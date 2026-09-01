const { getGuildStore } = require('./storage');
const { buildPunishSelectPayload } = require('./punish-handlers');

// Looks for a group letter A-L in the channel name, e.g. "group-a",
// "group_b-chat", or "a-lobby". Falls back to null if nothing matches.
function detectGroupFromChannelName(channelName) {
  const match = channelName.match(/group[-_ ]?([a-l])\b/i) || channelName.match(/^([a-l])[-_]/i);
  return match ? match[1].toUpperCase() : null;
}

module.exports = {
  name: 'punishteam',
  aliases: ['banteam'],
  description: "Run inside a group's channel to ban a team's whole roster",
  adminOnly: true,

  async execute(message, args) {
    const store = getGuildStore(message.guildId);
    const letter = (args[0] && args[0].trim().toUpperCase()) || detectGroupFromChannelName(message.channel.name || '');
    const payload = buildPunishSelectPayload(store.scrim, letter);

    if (payload.error) {
      return message.reply(payload.error).catch(() => {});
    }

    await message.channel.send(payload);
  },
};
