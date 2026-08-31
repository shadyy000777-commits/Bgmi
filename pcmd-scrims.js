const { getGuildStore } = require('./storage');
const { buildScrimWizardPayload } = require('./scrim-wizard-handlers');

module.exports = {
  name: 'scrims',
  aliases: ['scrim'],
  description: 'Open the scrim setup wizard — create, open/close, edit, or view the current scrim',
  adminOnly: true,

  async execute(message) {
    const store = getGuildStore(message.guildId);
    const payload = buildScrimWizardPayload(store);
    await message.channel.send(payload);
  },
};
