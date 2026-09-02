// Slots 1-5 are reserved and never assigned — the first team gets slot 6.
// From there, each group holds 20 teams (slot 6-25 = Group A, 26-45 = Group B, ...).
const FIRST_ASSIGNABLE_SLOT = 6;
const TEAMS_PER_GROUP = 20;

// Bijective base-26 letter codes so group letters never run out past 'Z':
// 0->A, 1->B, ..., 25->Z, 26->AA, 27->AB, ... (same scheme spreadsheet
// columns use). This lets a scrim have far more than 26 groups.
function letterForIndex(index) {
  let n = index + 1;
  let code = '';
  while (n > 0) {
    n -= 1;
    code = String.fromCharCode(65 + (n % 26)) + code;
    n = Math.floor(n / 26);
  }
  return code;
}

function indexForLetter(code) {
  let n = 0;
  for (const ch of code) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

function groupLetterForSlot(slotNumber) {
  const index = Math.floor((slotNumber - FIRST_ASSIGNABLE_SLOT) / TEAMS_PER_GROUP);
  return letterForIndex(index);
}

// Groups are tracked internally as letter codes (A, B, ..., Z, AA, AB, ...
// matching DEFAULT_SCHEDULE below and /set-group-role's storage keys for
// the first 12) but shown to players as numbers — "Group A" displays as
// "Group 1", etc.
function groupDisplayName(letter) {
  return `Group ${indexForLetter(letter) + 1}`;
}

// Slot numbers are tracked internally as one continuously incrementing
// global counter (so every stored key is guaranteed unique — no two teams
// can ever collide on the same key). But a real BGMI custom room only has
// 25 physical slots, so what gets shown to players must wrap back to
// 6-25 for every group instead of climbing past 25 (e.g. global slot 66 in
// Group D should display as slot 6, not 66). This only affects display —
// the underlying global number is still what's used for lookups/uniqueness.
function localSlotNumber(globalSlot) {
  return FIRST_ASSIGNABLE_SLOT + ((globalSlot - FIRST_ASSIGNABLE_SLOT) % TEAMS_PER_GROUP);
}

// Given a group letter, returns the [start, end] scrim-slot range that group
// covers for the current totalSlots (mirrors groupLetterForSlot in reverse).
function slotRangeForGroup(letter, totalSlots) {
  const index = indexForLetter(letter);
  const start = FIRST_ASSIGNABLE_SLOT + index * TEAMS_PER_GROUP;
  const end = Math.min(start + TEAMS_PER_GROUP - 1, totalSlots);
  return { start, end };
}

// Every group that currently has at least one open slot, with a free-slot
// count for each — used to build the "Change Slot" group picker.
function listGroupsWithFreeSlots(scrim) {
  const groups = [];
  for (let index = 0; ; index++) {
    const start = FIRST_ASSIGNABLE_SLOT + index * TEAMS_PER_GROUP;
    if (start > scrim.totalSlots) break;
    const end = Math.min(start + TEAMS_PER_GROUP - 1, scrim.totalSlots);
    let freeCount = 0;
    for (let i = start; i <= end; i++) {
      if (!scrim.slots[i]) freeCount++;
    }
    groups.push({ letter: letterForIndex(index), freeCount });
  }
  return groups;
}

// Every group letter that currently exists given totalSlots (A, B, C...),
// regardless of how full each one is — used by the live panel.
function activeGroupLetters(totalSlots) {
  const letters = [];
  for (let index = 0; ; index++) {
    const start = FIRST_ASSIGNABLE_SLOT + index * TEAMS_PER_GROUP;
    if (start > totalSlots) break;
    letters.push(letterForIndex(index));
  }
  return letters;
}

// Fallback match schedule per group (Group A = "Group 1", B = "Group 2",
// etc.) — used for any group an admin hasn't customized via !group_schedule.
// Each group plays 2 matches.
const DEFAULT_SCHEDULE = {
  A: { matches: [{ idp: '12:54', start: '01:00', map: 'Erangel' }, { idp: '01:34', start: '01:40', map: 'Miramar' }] },
  B: { matches: [{ idp: '01:04', start: '01:10', map: 'Rondo' }, { idp: '01:44', start: '01:50', map: 'Erangel' }] },
  C: { matches: [{ idp: '02:14', start: '02:20', map: 'Miramar' }, { idp: '02:54', start: '03:00', map: 'Rondo' }] },
  D: { matches: [{ idp: '02:44', start: '02:50', map: 'Erangel' }, { idp: '03:24', start: '03:30', map: 'Miramar' }] },
  E: { matches: [{ idp: '03:54', start: '04:00', map: 'Rondo' }, { idp: '04:34', start: '04:40', map: 'Erangel' }] },
  F: { matches: [{ idp: '04:54', start: '05:00', map: 'Miramar' }, { idp: '05:34', start: '05:40', map: 'Rondo' }] },
  G: { matches: [{ idp: '05:14', start: '05:20', map: 'Erangel' }, { idp: '05:54', start: '06:00', map: 'Miramar' }] },
  H: { matches: [{ idp: '07:14', start: '07:20', map: 'Rondo' }, { idp: '07:54', start: '08:00', map: 'Erangel' }] },
  I: { matches: [{ idp: '08:14', start: '08:20', map: 'Miramar' }, { idp: '08:54', start: '09:00', map: 'Rondo' }] },
  J: { matches: [{ idp: '08:44', start: '08:50', map: 'Erangel' }, { idp: '09:24', start: '09:30', map: 'Miramar' }] },
  K: { matches: [{ idp: '09:54', start: '10:00', map: 'Rondo' }, { idp: '10:34', start: '10:40', map: 'Erangel' }] },
  L: { matches: [{ idp: '10:54', start: '11:00', map: 'Miramar' }, { idp: '11:34', start: '11:40', map: 'Rondo' }] },
};

// An admin-set schedule (via !group_schedule) always wins over the default
// table for that letter — this is what makes the schedule editable live
// instead of requiring a code change.
function getSchedule(store, letter) {
  const custom = store.settings && store.settings.groupSchedule && store.settings.groupSchedule[letter];
  return custom || DEFAULT_SCHEDULE[letter] || null;
}

function setSchedule(store, letter, schedule) {
  if (!store.settings.groupSchedule) store.settings.groupSchedule = {};
  store.settings.groupSchedule[letter] = schedule;
}

// All schedule times are 12-hour-clock without AM/PM, and this bot's scrims
// run in a single stretch from ~12:54 PM through ~11:40 PM daily — so hour
// 12 stays as noon (PM) and hours 1-11 are treated as PM (add 12).
function parseMatchMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const hour24 = h === 12 ? 12 : h + 12;
  return hour24 * 60 + m;
}

// Reads the current wall-clock date/time in India Standard Time specifically
// (not the server's local time zone), since this schedule is built around
// IST regardless of where the bot process actually runs.
function getISTParts() {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map(p => [p.type, p.value]));
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    // hour12:false can render midnight as "24" in some engines instead of "00"
    hour: parts.hour === '24' ? 0 : parseInt(parts.hour, 10),
    minute: parseInt(parts.minute, 10),
  };
}

function formatDateLabel(anchorMs) {
  return new Date(anchorMs).toLocaleDateString('en-US', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

// Shared by matchScheduleLines and the live panel: works out whether a
// group's matches should be shown as "today" or have rolled to "tomorrow"
// (once every match today has already started).
function resolveGroupSchedule(letter, store) {
  const schedule = getSchedule(store, letter);
  if (!schedule) return null;

  const { year, month, day, hour, minute } = getISTParts();
  const nowMinutes = hour * 60 + minute;
  const todayAnchor = Date.UTC(year, month - 1, day);
  const tomorrowAnchor = todayAnchor + 24 * 60 * 60 * 1000;

  const upcoming = schedule.matches.filter(m => parseMatchMinutes(m.start) > nowMinutes);
  const isToday = upcoming.length > 0;
  const matchesToShow = isToday ? upcoming : schedule.matches;
  const dateLabel = formatDateLabel(isToday ? todayAnchor : tomorrowAnchor);

  return { schedule, isToday, dateLabel, matchesToShow };
}

function matchScheduleLines(letter, store) {
  const resolved = resolveGroupSchedule(letter, store);
  if (!resolved) {
    return "⏰ **Match Schedule** — not set yet for this group, check pinned messages or ask an admin.";
  }

  const { schedule, isToday, dateLabel, matchesToShow } = resolved;

  const lines = matchesToShow
    .map(m => {
      const originalIndex = schedule.matches.indexOf(m) + 1; // keep original Match 1/2 numbering
      return `⏰ **Match ${originalIndex}** — IDP ${m.idp} PM | Start ${m.start} PM | ${m.map}`;
    })
    .join('\n');

  return `📅 **${isToday ? 'Today' : 'Tomorrow'}, ${dateLabel}**\n${lines}`;
}

// Short one-line match-time summary for a group, used as select-menu
// option description text (not the full multi-line matchScheduleLines).
function groupTimeSummary(letter, store) {
  const schedule = getSchedule(store, letter);
  if (!schedule) return 'Schedule not set yet';
  return schedule.matches.map(m => `${m.start} PM`).join(' & ');
}

module.exports = {
  FIRST_ASSIGNABLE_SLOT,
  TEAMS_PER_GROUP,
  letterForIndex,
  indexForLetter,
  groupLetterForSlot,
  groupDisplayName,
  localSlotNumber,
  slotRangeForGroup,
  listGroupsWithFreeSlots,
  activeGroupLetters,
  getSchedule,
  setSchedule,
  resolveGroupSchedule,
  matchScheduleLines,
  groupTimeSummary,
};
