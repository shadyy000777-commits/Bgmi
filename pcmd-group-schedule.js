const { getGuildStore } = require('./storage');
const { buildGroupSchedulePanelPayload } = require('./group-schedule-handlers');

module.exports = {
  name: 'group_schedule',
  aliases: ['groupschedule'],
  description: "Post a panel to change a group's match date/time and maps",
  adminOnly: true,

  async execute(message) {
    const store = getGuildStore(message.guildId);
    const payload = buildGroupSchedulePanelPayload(store);
    await message.channel.send(payload);
  },
};
