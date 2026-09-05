// Human-like chat replies for the bot, backed by Groq's free-tier API
// (OpenAI-compatible chat completions). No cost — just a free API key from
// https://console.groq.com/keys
//
// This module only ever gets called from index.js when either:
//   1) someone @mentions the bot, or
//   2) the message is posted in the guild's configured AI help channel
// (see cmd-set-ai-channel.js / cmd-disable-ai-channel.js)

// Model is configurable in case Groq renames/retires the default later —
// just change GROQ_MODEL in .env, no code changes needed.
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

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
 * Ask Groq for a reply. Returns the reply text, or null if it couldn't
 * get one (missing key, API error, etc.) so the caller can fail quietly.
 */
async function getAIReply({ guildId, guildName, channelId, userDisplayName, userMessage }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.warn('[ai-chat] GROQ_API_KEY not set — skipping AI reply.');
    return null;
  }

  const history = channelHistory.get(channelId) || [];
  const messages = [
    { role: 'system', content: buildSystemPrompt(guildName) },
    ...history.map(h => ({
      role: h.role === 'bot' ? 'assistant' : 'user',
      content: h.text,
    })),
    { role: 'user', content: `${userDisplayName} says: ${userMessage}` },
  ];

  const url = 'https://api.groq.com/openai/v1/chat/completions';

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: 300,
        temperature: 0.8,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error(`[ai-chat] Groq API returned ${res.status}:`, errBody);
      return null;
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      console.error('[ai-chat] Groq API response had no text:', JSON.stringify(data));
      return null;
    }

    pushHistory(channelId, 'user', userMessage);
    pushHistory(channelId, 'bot', text);

    return text;
  } catch (err) {
    console.error('[ai-chat] Failed to reach Groq API:', err);
    return null;
  }
}

module.exports = { getAIReply };

