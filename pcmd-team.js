const { getGuildStore } = require('./storage');
const { buildVerifiedLogEmbed } = require('./verification-handlers');

module.exports = {
  name: 'team',
  aliases: ['viewteam'],
  description: "View a specific member's verified team card (usage: !team @user)",
  adminOnly: false,

  async execute(message) {
    const targetUser = message.mentions.users.first();
    if (!targetUser) {
      return message.reply('❌ Mention a user to look up — usage: `!team @user`');
    }

    const store = getGuildStore(message.guildId);
    const data = store.verifications && store.verifications[targetUser.id];

    if (!data) {
      return message.reply(`❌ ${targetUser} hasn't verified a team yet.`);
    }

    // Reuses the exact "TEAM VERIFICATION — Team Confirmed" card posted to
    // the verification log channel, so !team shows the same format.
    const embed = buildVerifiedLogEmbed(data, data.teamNumber, targetUser.id, false);

    await message.channel.send({ embeds: [embed] });
  },
};
