// Core music playback engine — one queue per guild. Commands (cmd-play.js,
// cmd-skip.js, cmd-stop.js, cmd-queue.js) call into this rather than talking
// to @discordjs/voice or play-dl directly, so all the guild-state bookkeeping
// lives in one place.
//
// Only single YouTube video links are supported for now — no playlists, no
// search-by-name, no Spotify (Spotify's own audio is DRM-protected; no bot
// can legally stream it directly — play-dl can only pull Spotify metadata
// and would need to re-source the actual audio from YouTube anyway).

const play = require('@iamtraction/play-dl');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState,
} = require('@discordjs/voice');

// guildId -> { connection, player, songs: [{ url, title, requestedBy }], textChannel }
const queues = new Map();

function getQueue(guildId) {
  return queues.get(guildId);
}

async function playNext(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return;

  const next = queue.songs[0];
  if (!next) {
    // Nothing left to play — leave the voice channel instead of sitting
    // there silently using up a voice connection slot for nothing.
    queue.connection.destroy();
    queues.delete(guildId);
    return;
  }

  try {
    // No extra "quality" option passed here on purpose — play-dl already
    // selects YouTube's highest-bitrate audio-only track by default, and
    // the stream type it returns (Opus, when available) gets passed straight
    // to createAudioResource below with zero re-encoding. That avoids the
    // quality loss a second transcode step would cause — this is already
    // the best quality path available. The real ceiling is whatever bitrate
    // YouTube itself encoded that video's audio at (typically ~128-160kbps
    // Opus) — no bot can exceed the source's own quality.
    const source = await play.stream(next.url);
    const resource = createAudioResource(source.stream, { inputType: source.type });
    queue.player.play(resource);
  } catch (err) {
    console.error('[music-manager] Failed to stream, skipping track:', err);
    queue.textChannel?.send(`⚠️ Couldn't play **${next.title}** (source error) — skipping.`).catch(() => {});
    queue.songs.shift();
    playNext(guildId);
  }
}

/**
 * Adds a track to the guild's queue, joining voice and starting playback if
 * nothing is currently playing. Returns { title, position } — position 1
 * means it started playing immediately, anything higher means it's queued.
 * Throws on an unsupported/invalid link so the calling command can show a
 * clear error instead of silently doing nothing.
 */
async function addAndPlay({ guildId, voiceChannel, textChannel, url, requestedBy, adapterCreator }) {
  const type = await play.validate(url);
  if (type !== 'yt_video') {
    throw new Error('Please provide a single YouTube video link — playlists and search terms aren\'t supported yet.');
  }

  let title = url;
  try {
    const info = await play.video_basic_info(url);
    title = info.video_details.title;
  } catch (err) {
    console.error('[music-manager] Could not fetch video info, using URL as title:', err);
  }

  let queue = queues.get(guildId);
  if (!queue) {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator,
    });

    const player = createAudioPlayer();
    connection.subscribe(player);

    queue = { connection, player, songs: [], textChannel };
    queues.set(guildId, queue);

    player.on(AudioPlayerStatus.Idle, () => {
      queue.songs.shift();
      playNext(guildId);
    });
    player.on('error', (err) => {
      console.error('[music-manager] Audio player error:', err);
      queue.songs.shift();
      playNext(guildId);
    });
    connection.on(VoiceConnectionStatus.Disconnected, () => {
      queues.delete(guildId);
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  }

  queue.songs.push({ url, title, requestedBy });

  if (queue.songs.length === 1) {
    await playNext(guildId);
  }

  return { title, position: queue.songs.length };
}

// Stops the current track — the player's Idle handler picks up the next
// queued song automatically, so this doesn't need to call playNext itself.
function skip(guildId) {
  const queue = queues.get(guildId);
  if (!queue || !queue.songs.length) return false;
  queue.player.stop();
  return true;
}

function stop(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return false;
  queue.songs = [];
  queue.connection.destroy();
  queues.delete(guildId);
  return true;
}

module.exports = { addAndPlay, skip, stop, getQueue };
