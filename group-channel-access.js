// Locks or unlocks a group's channel for its role. Denying SendMessages +
// AttachFiles still leaves ViewChannel/ReadMessageHistory alone, so the
// group can always see what was said — they just can't post anything new
// once closed. Admins bypass this automatically via Discord's own
// Administrator permission, which ignores channel overwrites entirely.
async function setGroupChannelOpen(channel, roleId, open, reason) {
  await channel.permissionOverwrites.edit(roleId, {
    ViewChannel: true,
    ReadMessageHistory: true,
    SendMessages: open,
    AttachFiles: open,
  }, { reason });
}

module.exports = { setGroupChannelOpen };
