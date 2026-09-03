const fs = require('fs');
const path = require('path');
const { todayDayNumber } = require('./group-schedule');

const DATA_FILE = path.join(__dirname, 'data.json');

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
//     verifications: { "<userId>": { team_name, owner_name, whatsapp, owner_email,
//       p1_ign, p1_uid, ..., p5_ign, p5_uid, registeredDate, teamNumber } },
//     teams: { "<userId>": { teamName, players: [<string>], updatedAt } },
//     settings: { verifyLogChannelId: "<channelId>" | null, registrationLogChannelId: "<channelId>" | null,
//       verifyTeamCounter: <number>, registeredRoleId: "<roleId>" | null,
//       groupRoles: { "<groupLetter A-L>": "<roleId>" }, teamPanelRoleId: "<roleId>" | null },
//     embeds: { "<name>": { title, description, color, url, image, thumbnail,
//       authorName, authorIcon, authorUrl, footerText, footerIcon, fields: [{name,value}] } }
//   }
// }

function loadAll() {
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

function getGuildStore(guildId) {
  const all = loadAll();
  if (!all[guildId]) {
    all[guildId] = { scrim: defaultScrim(), tournament: null, warnings: {}, verifications: {}, teams: {}, settings: {}, embeds: {} };
    saveAll(all);
  }
  // backfill in case an older data.json is missing newer keys
  if (!all[guildId].scrim) all[guildId].scrim = defaultScrim();
  if (all[guildId].tournament === undefined) all[guildId].tournament = null;
  if (all[guildId].warnings === undefined) all[guildId].warnings = {};
  if (all[guildId].verifications === undefined) all[guildId].verifications = {};
  if (all[guildId].teams === undefined) all[guildId].teams = {};
  if (all[guildId].settings === undefined) all[guildId].settings = {};
  if (all[guildId].embeds === undefined) all[guildId].embeds = {};
  return all[guildId];
}

function saveGuildStore(guildId, guildData) {
  const all = loadAll();
  all[guildId] = guildData;
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
