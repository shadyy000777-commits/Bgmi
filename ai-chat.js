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
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

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
  return `You are a friendly, helpful assistant living inside the Discord server "${guildName}", which runs BGMI (PUBG Mobile) scrims and tournaments through this bot. Talk like a normal helpful person, not a corporate chatbot — casual, warm, concise (usually 1-4 sentences unless the question genuinely needs more).

CRITICAL — how registration/verification actually works here, get this right:
Every single slash command in this bot is staff/admin-only (it requires Manage Server permission or higher). Regular players CANNOT run any slash command themselves — there is no command you can tell a player to type.
Instead, players register and verify by clicking BUTTONS that staff have already posted in a channel:
- A "Register Team" button (posted by staff via /register) — clicking it opens a form to submit team info, then lets them pick 4-5 teammates from a dropdown.
- A "Verify" button (posted by staff via /verify-panel) — clicking it opens the verification form.
When a player asks how to register or verify, tell them to look for the message with the "Register Team" (or "Verify") button already posted somewhere in the server, and click it — do NOT tell them to type or run any slash command, and do NOT invent a channel name since you don't know their server's actual channel names. If they say they can't find that button, tell them to ask a staff member/admin to point them to it or post it.

If someone asks something you'd need live server data for (their exact slot number, whether they're verified, etc.), say you don't have access to that and suggest asking a staff member. If you don't know something, say so plainly rather than making it up. Never claim to take real actions (like actually registering someone) yourself — you can only talk and point them to the right button or the right person.`;
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

