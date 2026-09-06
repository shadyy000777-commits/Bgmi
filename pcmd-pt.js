const { getGuildStore } = require('./storage');
const { buildPtPanel } = require('./pt-handlers');

module.exports = {
  name: 'pt',
  aliases: ['pointtable'],
  description: 'Post the Point Table Maker panel — build a match point table from lobby & result screenshots using AI (usage: !pt)',
  adminOnly: true,

  async execute(message) {
    const store = getGuildStore(message.guildId);
    const payload = buildPtPanel(store, message.guild);
    await message.channel.send(payload);
  },
};
