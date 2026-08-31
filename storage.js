const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');

// Per-guild data shape:
// {
//   "<guildId>": {
//     scrim: { open, scrimName, totalSlots, slots: { "1": {...} } } | null,
//     tournament: { name, open, groups: { "A": { capacity, teams: [] } }, qualified: [] } | null,
//     warnings: { "<userId>": [ { reason, moderatorId, timestamp } ] },
//     verifications: { "<userId>": { team_name, owner_name, whatsapp, owner_email,
//       p1_ign, p1_uid, ..., p5_ign, p5_uid, registeredDate, teamNumber } },
//     settings: { verifyLogChannelId: "<channelId>" | null, registrationLogChannelId: "<channelId>" | null,
//       verifyTeamCounter: <number>, registeredRoleId: "<roleId>" | null,
//       groupRoles: { "<groupLetter A-L>": "<roleId>" } },
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
    all[guildId] = { scrim: null, tournament: null, warnings: {}, verifications: {}, settings: {}, embeds: {} };
    saveAll(all);
  }
  // backfill in case an older data.json is missing newer keys
  if (all[guildId].tournament === undefined) all[guildId].tournament = null;
  if (all[guildId].warnings === undefined) all[guildId].warnings = {};
  if (all[guildId].verifications === undefined) all[guildId].verifications = {};
  if (all[guildId].settings === undefined) all[guildId].settings = {};
  if (all[guildId].embeds === undefined) all[guildId].embeds = {};
  return all[guildId];
}

function saveGuildStore(guildId, guildData) {
  const all = loadAll();
  all[guildId] = guildData;
  saveAll(all);
}

module.exports = { getGuildStore, saveGuildStore };
