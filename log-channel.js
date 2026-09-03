const { PermissionFlagsBits } = require('discord.js');
const { saveGuildStore } = require('./storage');

const LOG_CHANNEL_NAME = 'scrim-logs';

// Every verification, registration, slot change, and punishment gets
// posted here automatically — no admin setup command needed. The channel
// is created once per guild, the first time anything needs to log
// something, and reused after that.
//
// Visibility: @everyone is denied, and any role that currently holds
// Administrator or Manage Server is explicitly granted view access — so it
// behaves like a normal staff-only channel without needing anyone to
// manually create or configure one. (This is a snapshot at creation time;
// if admin roles change later, permissions on this channel don't
// automatically follow — same as any other channel in the server.)
//
// If a specific channel was already configured manually via the older
// /set-verify-channel or /set-registration-channel commands, callers
// should prefer that over this — this is only the automatic fallback.
async function getOrCreateLogChannel(guild, store) {
  if (!store.settings) store.settings = {};
  const existingId = store.settings.logChannelId;
  const existing = existingId ? guild.channels.cache.get(existingId) : null;
  if (existing) return existing;

  const botMember = guild.members.me;
  if (!botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
    console.error(`[log-channel] Bot is missing "Manage Channels" in guild ${guild.id} — can't auto-create the log channel.`);
    return null;
  }

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
  ];
  for (const role of guild.roles.cache.values()) {
    if (role.permissions.has(PermissionFlagsBits.Administrator) || role.permissions.has(PermissionFlagsBits.ManageGuild)) {
      overwrites.push({ id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] });
    }
  }

  try {
    const channel = await guild.channels.create({
      name: LOG_CHANNEL_NAME,
      permissionOverwrites: overwrites,
      reason: 'Auto-created to log verifications, registrations, slot changes, and punishments',
    });
    store.settings.logChannelId = channel.id;
    saveGuildStore(guild.id, store);
    return channel;
  } catch (err) {
    console.error(`[log-channel] Failed to auto-create the log channel in guild ${guild.id}:`, err.message);
    return null;
  }
}

// Resolves the channel to actually log to: a manually-configured channel
// (fallbackChannelId, e.g. from /set-verify-channel) if one is set and
// still exists, otherwise the auto-created shared log channel.
async function resolveLogChannel(guild, store, fallbackChannelId) {
  if (fallbackChannelId) {
    const configured = guild.channels.cache.get(fallbackChannelId);
    if (configured) return configured;
  }
  return getOrCreateLogChannel(guild, store);
}

module.exports = { getOrCreateLogChannel, resolveLogChannel, LOG_CHANNEL_NAME };
