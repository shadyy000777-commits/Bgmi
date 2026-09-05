// Human-like chat replies for the bot, backed by Google Gemini's free-tier
// API. No cost — you just need a free API key from https://aistudio.google.com/apikey
//
// This module only ever gets called from index.js when either:
//   1) someone @mentions the bot, or
//   2) the message is posted in the guild's configured AI help channel
// (see cmd-set-ai-channel.js / cmd-disable-ai-channel.js)

// Model is configurable in case Google renames/retires the default later —
// just change GEMINI_MODEL in .env, no code changes needed.
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

// Keeps the last few exchanges per channel in memory only (not saved to
// data.json) so replies feel like a real conversation instead of each
// message being answered with zero context. Resets on restart — that's
// fine, it's just short-term "what did we just say" memory, not anything
// that needs to survive a redeploy.
const HISTORY_LIMIT = 8; // messages (user+bot combined) kept per channel
const channelHistory = new Map();

function pushHistory(channelId, role, text) {
  if (!channelHistory.has(channelId)) channelHistory.set(channelId, []);
  const hist = channelHistory.get(channelId);
  hist.push({ role, text });
  while (hist.length > HISTORY_LIMIT) hist.shift();
}

function buildSystemPrompt(guildName) {
  return `You are a friendly, helpful assistant living inside the Discord server "${guildName}", which runs BGMI (PUBG Mobile) scrims and tournaments through this bot. Talk like a normal helpful person, not a corporate chatbot — casual, warm, concise (usually 1-4 sentences unless the question genuinely needs more). Use Discord markdown lightly (bold, code for commands) when useful, not constantly.

You know this bot's own slash commands and can point people to them when relevant:
- /panel and /scrim-register — register a team for scrims
- /scrim-slotlist — see the current slot list
- /scrim-open, /scrim-cancel, /scrim-close — admin scrim controls
- /tournament-create, /tournament-register, /tournament-groups, /tournament-qualify, /tournament-qualified, /tournament-reset — tournament system
- /kick, /ban, /timeout, /untimeout, /warn, /warnings, /clear — moderation (admin only)
- /userinfo, /serverinfo — info lookups

If someone asks something you'd need live server data for (their exact slot number, whether they're verified, etc.), tell them which command shows that instead of guessing. If you don't know something, say so plainly rather than making it up. Never claim to take real actions (like actually registering someone or banning someone) — you can only talk; tell them to use the real command for that.`;
}

/**
 * Ask Gemini for a reply. Returns the reply text, or null if it couldn't
 * get one (missing key, API error, etc.) so the caller can fail quietly.
 */
async function getAIReply({ guildId, guildName, channelId, userDisplayName, userMessage }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[ai-chat] GEMINI_API_KEY not set — skipping AI reply.');
    return null;
  }

  const history = channelHistory.get(channelId) || [];
  const contents = [
    { role: 'user', parts: [{ text: buildSystemPrompt(guildName) }] },
    { role: 'model', parts: [{ text: 'Got it — I\'ll keep it casual, short, and point people to the right command when it fits.' }] },
    ...history.map(h => ({
      role: h.role === 'bot' ? 'model' : 'user',
      parts: [{ text: h.text }],
    })),
    { role: 'user', parts: [{ text: `${userDisplayName} says: ${userMessage}` }] },
  ];

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: { maxOutputTokens: 300, temperature: 0.8 },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error(`[ai-chat] Gemini API returned ${res.status}:`, errBody);
      return null;
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('').trim();
    if (!text) {
      console.error('[ai-chat] Gemini API response had no text:', JSON.stringify(data));
      return null;
    }

    pushHistory(channelId, 'user', userMessage);
    pushHistory(channelId, 'bot', text);

    return text;
  } catch (err) {
    console.error('[ai-chat] Failed to reach Gemini API:', err);
    return null;
  }
}

module.exports = { getAIReply };
