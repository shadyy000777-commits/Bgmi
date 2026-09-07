const { createCanvas } = require('@napi-rs/canvas');

// A handful of built-in color themes for "Change Design" to cycle through.
// Not trying to pixel-match any other bot's specific artwork/branding —
// this is our own original look, just aiming for the same "polished
// esports graphic" category of result.
const THEMES = {
  navy: { name: 'Navy', bg1: '#0a0f1f', bg2: '#111a33', accent: '#3b82f6', accentText: '#93c5fd', total: '#facc15' },
  crimson: { name: 'Crimson', bg1: '#1a0a0f', bg2: '#2b0f18', accent: '#ef4444', accentText: '#fca5a5', total: '#facc15' },
  emerald: { name: 'Emerald', bg1: '#08140f', bg2: '#0e2419', accent: '#22c55e', accentText: '#86efac', total: '#facc15' },
};

const DEFAULT_THEME = 'navy';

function themeNames() {
  return Object.keys(THEMES);
}

function getTheme(key) {
  return THEMES[key] || THEMES[DEFAULT_THEME];
}

function truncate(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(out + '…').width > maxWidth) {
    out = out.slice(0, -1);
  }
  return out + '…';
}

/**
 * Renders the point table as a PNG buffer, in the same spirit as the
 * screenshot you shared: title banner, #/TEAM NAME/FP/PP/TT columns, a row
 * per registered team (including teams that scored 0), medal colors for
 * the top 3, and a footer with your Design PT branding.
 *
 * @param {Array<{teamName:string, kills:number, placementPoints:number, totalPoints:number, wins:number}>} rows
 * @param {{serverName:?string, instagram:?string, discordInvite:?string, youtube:?string}} design
 * @param {string} themeKey
 * @returns {Buffer}
 */
function renderPointTableImage(rows, design, themeKey) {
  const theme = getTheme(themeKey);

  const width = 1080;
  const titleHeight = 190;
  const headerHeight = 56;
  const rowHeight = 46;
  const footerHeight = design && (design.instagram || design.discordInvite || design.youtube) ? 60 : 24;
  const height = titleHeight + headerHeight + rowHeight * rows.length + footerHeight + 20;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, theme.bg1);
  bg.addColorStop(1, theme.bg2);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 54px sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('POINT TABLE', 50, 90);

  ctx.fillStyle = theme.accentText;
  ctx.font = '24px sans-serif';
  ctx.fillText(design?.serverName || 'BGMI Scrim', 50, 130);

  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(50, 155);
  ctx.lineTo(width - 50, 155);
  ctx.stroke();

  // Column layout
  const cols = {
    rank: { x: 50, w: 70 },
    team: { x: 140, w: 560 },
    fp: { x: 720, w: 90 },
    pp: { x: 830, w: 90 },
    tt: { x: 940, w: 90 },
  };

  let y = titleHeight;

  // Header row
  ctx.fillStyle = theme.accent;
  ctx.fillRect(50, y, width - 100, headerHeight);
  ctx.fillStyle = '#0a0a0a';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('#', cols.rank.x + 20, y + 36);
  ctx.fillText('TEAM NAME', cols.team.x, y + 36);
  ctx.fillText('FP', cols.fp.x + 25, y + 24);
  ctx.font = '12px sans-serif';
  ctx.fillText('(Kills)', cols.fp.x + 15, y + 42);
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('PP', cols.pp.x + 25, y + 24);
  ctx.font = '12px sans-serif';
  ctx.fillText('(Placement)', cols.pp.x, y + 42);
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('TT', cols.tt.x + 25, y + 36);

  y += headerHeight;

  // Rows
  rows.forEach((r, i) => {
    const rank = i + 1;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)';
    ctx.fillRect(50, y, width - 100, rowHeight);

    // Rank badge — medal colors for top 3
    const medalColors = { 1: '#facc15', 2: '#d1d5db', 3: '#d97706' };
    ctx.fillStyle = medalColors[rank] || '#374151';
    ctx.fillRect(cols.rank.x, y + 8, 50, rowHeight - 16);
    ctx.fillStyle = medalColors[rank] ? '#0a0a0a' : '#e5e7eb';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText(String(rank).padStart(2, '0'), cols.rank.x + 12, y + 30);

    ctx.fillStyle = '#f3f4f6';
    ctx.font = '18px sans-serif';
    ctx.fillText(truncate(ctx, r.teamName.toUpperCase(), cols.team.w), cols.team.x, y + 29);

    ctx.font = 'bold 18px sans-serif';
    ctx.fillStyle = '#e5e7eb';
    ctx.fillText(String(r.kills), cols.fp.x + 30, y + 29);
    ctx.fillText(String(r.placementPoints), cols.pp.x + 30, y + 29);

    ctx.fillStyle = theme.total;
    ctx.fillText(String(r.totalPoints), cols.tt.x + 30, y + 29);

    y += rowHeight;
  });

  // Footer branding
  if (footerHeight > 24) {
    ctx.fillStyle = theme.accentText;
    ctx.font = '16px sans-serif';
    const parts = [];
    if (design.discordInvite) parts.push(`Discord: ${design.discordInvite}`);
    if (design.instagram) parts.push(`Instagram: ${design.instagram}`);
    if (design.youtube) parts.push(`YouTube: ${design.youtube}`);
    ctx.fillText(parts.join('   •   '), 50, y + 34);
  }

  return canvas.toBuffer('image/png');
}

module.exports = { renderPointTableImage, themeNames, getTheme, DEFAULT_THEME };
