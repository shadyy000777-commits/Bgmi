const fs = require('fs');
const path = require('path');
const { todayDayNumber } = require('./group-schedule');

// Railway auto-injects RAILWAY_VOLUME_MOUNT_PATH once a Volume is attached
// to this service, pointing at that volume's mount path (e.g. "/data") —
// using it here means data.json lives on the persistent disk instead of
// inside the app's own code folder, so it survives every redeploy instead
// of getting wiped when Railway rebuilds from the latest GitHub push.
// DATA_DIR is a manual override for other hosts; falls back to this
// folder (old behavior) if neither is set, e.g. for local development.
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');

// Verified team data lives in its own dedicated file, completely separate
// from data.json. Every other feature (scrim, tournament, settings, etc.)
// reads and writes data.json constantly as admins run commands — keeping
// verifications in their own file means none of that can ever accidentally
// overwrite or corrupt player verification records, and this file alone can
// be backed up/restored independently of everything else.
const VERIFICATIONS_FILE = path.join(DATA_DIR, 'verifications.json');

// If this is the very first boot after attaching a fresh volume, the
// directory exists (Railway creates it) but nothing does — the rest of
// this module already handles a missing data.json fine (loadAll returns
// {}), so nothing else needs to change here.

// Registration runs 24/7 with no admin setup step — every guild gets a
// standing scrim automatically, sized generously (1000 groups) so it never
// needs to be manually resized.
const DEFAULT_TOTAL_SLOTS = 20000;

function defaultScrim() {
  return { scrimName: 'BGMI Scrim', totalSlots: DEFAULT_TOTAL_SLOTS, slots: {}, createdDayNumber: todayDayNumber() };
}

// Per-guild data shape:
// {
//   "<guildId>": {
//     scrim: { open, scrimName, totalSlots, slots: { "1": {...} } } | null,
//     tournament: { name, open, groups: { "A": { capacity, teams: [] } }, qualified: [] } | null,
//     warnings: { "<userId>": [ { reason, moderatorId, timestamp } ] },
//     // verifications lives in verifications.json now, NOT here — see
//     // loadVerificationsAll/saveVerificationsAll. getGuildStore still
//     // attaches it under store.verifications for callers' convenience, and
//     // saveGuildStore still splits it back out — so every existing caller
//     // reads/writes store.verifications exactly as before.
//     teams: { "<userId>": { teamName, players: [<string>], updatedAt } },
//     settings: { verifyLogChannelId: "<channelId>" | null, registrationLogChannelId: "<channelId>" | null,
//       privateRegistrationLogChannelId: "<channelId>" | null, privateVerifyLogChannelId: "<channelId>" | null,
//       verificationBackupChannelId: "<channelId>" | null, verificationBackupMessageId: "<messageId>" | null,
//       verifyTeamCounter: <number>, registeredRoleId: "<roleId>" | null, verifiedRoleId: "<roleId>" | null,
//       groupRoles: { "<groupLetter A-L>": "<roleId>" }, teamPanelRoleId: "<roleId>" | null },
//     embeds: { "<name>": { title, description, color, url, image, thumbnail,
//       authorName, authorIcon, authorUrl, footerText, footerIcon, fields: [{name,value}] } }
//   }
// }

function loadAll() {
  // One-time migration: the first time this runs after attaching a volume,
  // the volume's data.json won't exist yet — but the *old* data.json (the
  // one that was living in the code folder, uploaded/committed before this
  // change) might still be sitting right next to this file. Seed the
  // volume from it once so existing verifications/registrations aren't
  // lost in the switch-over, instead of silently starting empty.
  if (!fs.existsSync(DATA_FILE)) {
    const legacyPath = path.join(__dirname, 'data.json');
    if (DATA_FILE !== legacyPath && fs.existsSync(legacyPath)) {
      try {
        fs.copyFileSync(legacyPath, DATA_FILE);
        console.log(`[storage] Migrated existing data.json into persistent volume at ${DATA_FILE}`);
      } catch (err) {
        console.error('[storage] Failed to migrate legacy data.json onto the volume:', err.message);
      }
    }
  }

  if (!fs.existsSync(DATA_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    console.error('Failed to parse data.json, starting fresh:', err);
    return {};
  }
}

function saveAll(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function loadVerificationsAll() {
  if (!fs.existsSync(VERIFICATIONS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(VERIFICATIONS_FILE, 'utf8'));
  } catch (err) {
    console.error('Failed to parse verifications.json, starting fresh:', err);
    return {};
  }
}

function saveVerificationsAll(data) {
  fs.writeFileSync(VERIFICATIONS_FILE, JSON.stringify(data, null, 2));
}

function getGuildStore(guildId) {
  const all = loadAll();
  if (!all[guildId]) {
    all[guildId] = { scrim: defaultScrim(), tournament: null, warnings: {}, teams: {}, settings: {}, embeds: {} };
    saveAll(all);
  }
  // backfill in case an older data.json is missing newer keys
  if (!all[guildId].scrim) all[guildId].scrim = defaultScrim();
  if (all[guildId].tournament === undefined) all[guildId].tournament = null;
  if (all[guildId].warnings === undefined) all[guildId].warnings = {};
  if (all[guildId].teams === undefined) all[guildId].teams = {};
  if (all[guildId].settings === undefined) all[guildId].settings = {};
  if (all[guildId].embeds === undefined) all[guildId].embeds = {};

  const allVerifications = loadVerificationsAll();
  // One-time migration per guild: if verifications were still sitting in the
  // old data.json (from before this split) and haven't been moved over yet,
  // move them now so nothing already saved gets lost in the switch-over.
  if (all[guildId].verifications && Object.keys(all[guildId].verifications).length && !allVerifications[guildId]) {
    allVerifications[guildId] = all[guildId].verifications;
    saveVerificationsAll(allVerifications);
  }
  all[guildId].verifications = allVerifications[guildId] || {};

  return all[guildId];
}

function saveGuildStore(guildId, guildData) {
  // Verifications are split off into their own dedicated file — everything
  // else about this guild still goes into data.json exactly as before.
  const allVerifications = loadVerificationsAll();
  allVerifications[guildId] = guildData.verifications || {};
  saveVerificationsAll(allVerifications);

  const { verifications, ...rest } = guildData;
  const all = loadAll();
  all[guildId] = rest;
  saveAll(all);
}

// Tracks the most recent /dm sent to each Discord user, globally (not
// scoped to one guild — DM channels have no guild context of their own).
// Lets a later reply in that DM get relayed back to wherever it came from.
// Stored under a reserved top-level key that can never collide with a real
// guild ID (guild IDs are pure numeric snowflakes).
function getDmThread(userId) {
  const all = loadAll();
  return (all._dmThreads && all._dmThreads[userId]) || null;
}

function setDmThread(userId, thread) {
  const all = loadAll();
  if (!all._dmThreads) all._dmThreads = {};
  all._dmThreads[userId] = thread;
  saveAll(all);
}

function listGuildIds() {
  return Object.keys(loadAll());
}

module.exports = { getGuildStore, saveGuildStore, getDmThread, setDmThread, listGuildIds };
