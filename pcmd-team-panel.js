const { getGuildStore, saveGuildStore } = require('./storage');
const { buildTeamPanelPayload } = require('./team-panel-handlers');

module.exports = {
  name: 'team_panel',
  aliases: ['teampanel'],
  description: 'Post a Create/Edit/Delete Team panel restricted to a role — usage: !team_panel @role',
  adminOnly: true,

  async execute(message) {
    const role = message.mentions.roles.first();
    if (!role) {
      return message.reply('❌ Mention a role, e.g. `!team_panel @Team Owners`').catch(() => {});
    }

    const store = getGuildStore(message.guildId);
    store.settings.teamPanelRoleId = role.id;
    saveGuildStore(message.guildId, store);

    const payload = buildTeamPanelPayload(role);
    await message.channel.send(payload);
  },
};
