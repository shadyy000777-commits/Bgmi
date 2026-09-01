const { EmbedBuilder } = require('discord.js');
const { getDmThread } = require('./storage');

// Called for every message received in a DM channel (not a guild channel).
// If this user was recently DMed via /dm, forwards their reply into the
// channel that command was run from, so the moderator actually sees it.
async function relayDmReply(message, client) {
  const thread = getDmThread(message.author.id);
  if (!thread) return; // this user was never DMed by us — nothing to relay to

  let channel;
  try {
    channel = await client.channels.fetch(thread.channelId);
  } catch (err) {
    return; // channel deleted or bot removed from that server — nothing we can do
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setAuthor({ name: `${message.author.tag} replied to your DM`, iconURL: message.author.displayAvatarURL() })
    .setDescription(message.content || '_(no text — see attachment(s) below)_')
    .setFooter({ text: `Sent via /dm by <@${thread.moderatorId}>` })
    .setTimestamp();

  const files = message.attachments.map(a => a.url);

  try {
    await channel.send({
      content: `<@${thread.moderatorId}>`,
      embeds: [embed],
      files: files.length ? files : undefined,
    });
  } catch (err) {
    console.error(`Failed to relay DM reply from ${message.author.tag}:`, err);
  }
}

module.exports = { relayDmReply };
