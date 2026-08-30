// Holds in-progress "Register Team" data between the 3 modal steps, for the
// /register flow specifically. Kept separate from pending-verifications.js
// so a player filling out /register and /verify-panel at the same time (edge
// case, but possible) don't overwrite each other's in-progress data.
//
// In-memory only, same reasoning as pending-verifications.js: if the bot
// restarts mid-form, the player just clicks the button again and restarts.

const pending = new Map();
const TTL_MS = 15 * 60 * 1000; // 15 minutes to finish the form

function startPending(userId, guildId, mode = 'create', original = null) {
  clearPending(userId);
  const entry = {
    guildId,
    mode,        // 'create' (fresh team) or 'edit' (updating the saved profile first)
    original,    // snapshot of the existing profile, used to prefill edit modals
    data: {},
    timer: setTimeout(() => pending.delete(userId), TTL_MS),
  };
  pending.set(userId, entry);
  return entry;
}

function getPending(userId) {
  return pending.get(userId) || null;
}

function updatePending(userId, fields) {
  const entry = pending.get(userId);
  if (!entry) return null;
  Object.assign(entry.data, fields);
  return entry;
}

function clearPending(userId) {
  const entry = pending.get(userId);
  if (entry && entry.timer) clearTimeout(entry.timer);
  pending.delete(userId);
}

module.exports = { startPending, getPending, updatePending, clearPending };
