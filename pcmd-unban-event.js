const { getGuildStore, saveGuildStore } = require('./storage');

module.exports = {
  name: 'unban_event',
  aliases: ['unbanevent'],
  description: 'Lift an event-scoped punishment early — usage: !unban_event <scrim|tournament> @user',
  adminOnly: true,

  async execute(message, args) {
    const eventType = (args[0] || '').toLowerCase();
    const user = message.mentions.users.first();

    if ((eventType !== 'scrim' && eventType !== 'tournament') || !user) {
      return message.reply('❌ Usage: `!unban_event <scrim|tournament> @user`').catch(() => {});
    }

    const store = getGuildStore(message.guildId);
    const record = store.settings.punishments && store.settings.punishments[user.id];

    if (!record || record.eventType !== eventType) {
      return message.reply(`❌ No **${eventType}**-scoped punishment on file for ${user}.`).catch(() => {});
    }

    try {
      await message.guild.bans.remove(user.id, `Unbanned early via !unban_event by ${message.author.tag}`);
    } catch (err) {
      console.error('Failed to unban via !unban_event:', err);
      return message.reply(`❌ Couldn't unban ${user} — they may already be unbanned, or I'm missing the **Ban Members** permission.`).catch(() => {});
    }

    delete store.settings.punishments[user.id];
    saveGuildStore(message.guildId, store);

    await message.reply(`✅ Lifted the **${eventType}** punishment for ${user} — they were banned for team **${record.team}** (Group ${record.group}).`).catch(() => {});
  },
};
