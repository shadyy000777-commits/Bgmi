const { getGuildStore } = require('./storage');
const { buildTournamentWizardPayload } = require('./tournament-wizard-handlers');

module.exports = {
  name: 'tournament',
  aliases: ['tournaments'],
  description: 'Open the tournament setup wizard — create, add groups, open/close, or view the current tournament',
  adminOnly: true,

  async execute(message) {
    const store = getGuildStore(message.guildId);
    const payload = buildTournamentWizardPayload(store);
    await message.channel.send(payload);
  },
};
