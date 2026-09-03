const { PermissionFlagsBits } = require('discord.js');
const { getGuildStore } = require('./storage');
const { groupDisplayName, letterForIndex } = require('./group-schedule');

// Accepts either the group number players see ("1", "2" -> "Group 1",
// "Group 2") or the internal letter code directly ("A", "B"). Falls back to
// whichever group's channel this command is run in when no argument is
// given, by reverse-looking-up the channel it was typed in.
function resolveGroupLetter(store, message, arg) {
  if (arg) {
    if (/^[0-9]+$/.test(arg)) {
      return letterForIndex(parseInt(arg, 10) - 1);
    }
    return arg.toUpperCase();
  }

  const groupChannels = (store.settings && store.settings.groupChannels) || {};
  const found = Object.entries(groupChannels).find(([, channelId]) => channelId === message.channel.id);
  return found ? found[0] : null;
}

module.exports = {
  name: 'open',
  description: "Open a group's channel so everyone holding that group's role can send messages and attach files (usage: !open <group number>, or run it inside the group's own channel)",
  adminOnly: true,

  async execute(message, args) {
    const store = getGuildStore(message.guildId);
    const letter = resolveGroupLetter(store, message, args[0]);

    if (!letter) {
      return message.reply("❌ Tell me which group — `!open <number>` (e.g. `!open 1`), or run this inside the group's own channel.");
    }

    const channelId = store.settings && store.settings.groupChannels && store.settings.groupChannels[letter];
    const roleId = store.settings && store.settings.groupRoles && store.settings.groupRoles[letter];

    if (!channelId || !roleId) {
      return message.reply(`❌ No channel/role exists yet for **${groupDisplayName(letter)}** — it's created automatically once someone registers into it.`);
    }

    const channel = message.guild.channels.cache.get(channelId);
    if (!channel) {
      return message.reply(`❌ **${groupDisplayName(letter)}**'s channel no longer exists.`);
    }

    const botMember = message.guild.members.me;
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return message.reply('❌ I need the **Manage Roles** permission to edit that channel\'s permissions.');
    }

    try {
      await channel.permissionOverwrites.edit(roleId, {
        ViewChannel: true,
        SendMessages: true,
        AttachFiles: true,
      }, { reason: `Opened by ${message.author.tag} via !open` });
    } catch (err) {
      console.error(`[open] Failed to open ${groupDisplayName(letter)}'s channel in guild ${message.guildId}: ${err.code ?? ''} ${err.message}`);
      return message.reply("❌ Something went wrong opening that channel — make sure my role sits above the group's role.");
    }

    await message.channel.send(
      `🔓 **${groupDisplayName(letter)}** is now open — everyone with that group's role can send messages and attach files in <#${channelId}>.`
    );
  },
};
