const { buildIdPanelPayload } = require('./id-panel-handlers');

module.exports = {
  name: 'id_panel',
  aliases: ['idpanel'],
  description: 'Post a persistent panel for sending Room ID/Password/Map to any channel',
  adminOnly: true,

  async execute(message) {
    const payload = buildIdPanelPayload();
    await message.channel.send(payload);
  },
};
