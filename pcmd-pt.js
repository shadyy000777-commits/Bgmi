const { getGuildStore } = require('./storage');
const { buildPointTablePanel } = require('./point-table');

module.exports = {
  name: 'pt',
  aliases: ['pointtable', 'pointtablemaker'],
  description: 'Post the Point Table Maker panel — AI-generated PTs from lobby & result screenshots',

  async execute(message) {
    const store = getGuildStore(message.guildId);
    await message.channel.send(buildPointTablePanel(store));
  },
};
