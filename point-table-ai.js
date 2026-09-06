// Reads BGMI lobby + result screenshots with a vision-capable model on
// Groq's free-tier API (same account/key as ai-chat.js — no second API key
// needed) and turns them into structured match data the rest of the Point
// Table feature can do reliable arithmetic on.
//
// Groq's multimodal model lineup changes fairly often, so — same pattern as
// ai-chat.js's GROQ_MODEL — the vision model is configurable via env var
// instead of hardcoded. Check https://console.groq.com/docs/vision for the
// current recommended model if the default below ever gets deprecated.
const VISION_MODEL = process.env.GROQ_VISION_MODEL || 'qwen/qwen3.6-27b';

// Groq's on-demand/free tier caps requests at a fairly low tokens-per-minute
// (TPM) budget, and each image costs a real chunk of that budget — sending
// several images in one request (or firing requests back-to-back) blows
// past it fast (error looks like "Request too large... Limit 1000,
// Requested 1332"). So: one image per request, a small delay between
// requests, and a retry-with-backoff if Groq still says to slow down.
const MAX_IMAGES_PER_REQUEST = 1;
const DELAY_BETWEEN_REQUESTS_MS = 2200;
const MAX_RETRIES = 3;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callGroqVision(apiKey, systemPrompt, userText, imageUrls) {
  const content = [{ type: 'text', text: userText }];
  for (const url of imageUrls) {
    content.push({ type: 'image_url', image_url: { url } });
  }

  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // Back off a bit longer each retry — Groq's 429s on the free tier are
      // usually "wait a few seconds", not "you're banned".
      await sleep(DELAY_BETWEEN_REQUESTS_MS * (attempt + 1));
    }

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content },
        ],
        temperature: 0.2,
        max_completion_tokens: 800,
        response_format: { type: 'json_object' },
        // qwen3.6-27b is a "thinking" model by default — left alone, it
        // spends its token budget writing an internal <think> block before
        // ever getting to the actual JSON answer, which with a small
        // max_completion_tokens (kept small on purpose to stay under the
        // TPM cap above) meant it ran out of room and returned nothing.
        // This is plain extraction, not something that needs reasoning, so
        // turn thinking off entirely and only surface the final answer.
        reasoning_effort: 'none',
        reasoning_format: 'hidden',
      }),
    });

    if (res.status === 429 && attempt < MAX_RETRIES) {
      lastErr = new Error('Rate limited by Groq — retrying.');
      continue;
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Groq vision API returned ${res.status}: ${errBody}`);
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error(`Groq vision API returned no content. Full response: ${JSON.stringify(data).slice(0, 500)}`);
    }

    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error(`Could not parse JSON from vision model: ${text.slice(0, 300)}`);
    }
  }

  throw lastErr || new Error('Groq vision API failed after retries.');
}

const LOBBY_SYSTEM_PROMPT = `You read BGMI (PUBG Mobile) custom-room lobby screenshots. Each screenshot shows a list of team/slot numbers with the players in that team.

Respond with ONLY a JSON object, no prose, in this exact shape:
{ "teams": [ { "slot": <number or null>, "teamName": "<string>", "players": ["<string>", ...] } ] }

Rules:
- teamName is whatever name identifies the team in the lobby (a clan tag, a team name, or the leader's IGN if that's all that's shown).
- If a team's real name isn't visible, use the leader/first player's IGN as the team name.
- List every team/slot you can see across all the screenshots. Do not invent teams that aren't visible.`;

const RESULT_SYSTEM_PROMPT = `You read BGMI (PUBG Mobile) match result / summary screenshots. Each screenshot is the end-of-match results table for ONE match, showing each team's placement (rank) and kill count. Some screenshots may show a "WWCD" or "#1" for the winning team.

Respond with ONLY a JSON object, no prose, in this exact shape:
{ "matches": [ { "map": "<string or null>", "results": [ { "placement": <number>, "teamName": "<string>", "kills": <number> } ] } ] }

Rules:
- teamName should match how it's written on the results screen (team name, clan tag, or leader IGN — whatever is shown).
- placement is the numeric rank (1 = winner/WWCD). kills is the team's total kill count for that match.
- If the map name is visible (Erangel, Miramar, Sanhok, Vikendi, Livik, Rondo, etc.) include it, otherwise use null.
- Include every row you can read. Do not invent teams or numbers you can't actually see.`;

/**
 * Reads lobby screenshots into a team roster.
 * @returns {Promise<{teams: Array<{slot: number|null, teamName: string, players: string[]}>}>}
 */
async function readLobbyScreenshots(imageUrls, slotlistText) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set.');

  const batches = chunk(imageUrls, MAX_IMAGES_PER_REQUEST);
  const allTeams = [];

  for (let i = 0; i < batches.length; i++) {
    if (i > 0) await sleep(DELAY_BETWEEN_REQUESTS_MS);
    let userText = 'Read the lobby slot list from this screenshot.';
    if (slotlistText && slotlistText.trim()) {
      userText += ` For reference, here is the pasted slotlist (use it to correct/complete team names where the OCR is ambiguous, but still only list teams actually visible or referenced):\n${slotlistText.trim()}`;
    }
    const parsed = await callGroqVision(apiKey, LOBBY_SYSTEM_PROMPT, userText, batches[i]);
    if (Array.isArray(parsed?.teams)) allTeams.push(...parsed.teams);
  }

  return { teams: allTeams };
}

/**
 * Reads result screenshots into per-match placement/kill data.
 * @returns {Promise<{matches: Array<{map: string|null, results: Array<{placement:number, teamName:string, kills:number}>}>}>}
 */
async function readResultScreenshots(imageUrls) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set.');

  const batches = chunk(imageUrls, MAX_IMAGES_PER_REQUEST);
  const allMatches = [];

  for (let i = 0; i < batches.length; i++) {
    if (i > 0) await sleep(DELAY_BETWEEN_REQUESTS_MS);
    const userText = 'Read the match result table from this screenshot.';
    const parsed = await callGroqVision(apiKey, RESULT_SYSTEM_PROMPT, userText, batches[i]);
    if (Array.isArray(parsed?.matches)) allMatches.push(...parsed.matches);
  }

  return { matches: allMatches };
}

module.exports = { readLobbyScreenshots, readResultScreenshots, VISION_MODEL };
