require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, MessageFlags, PermissionFlagsBits, REST, Routes, ActivityType } = require('discord.js');
const {
  handleRegisterButton, handleStep1Submit, handleStep2Button, handleStep2Submit,
  handleStep3Button, handleStep3Submit,
} = require('./registration-handlers');
const {
  handleVerifyButton, handleVerifyEditButton, handleVerifyStep1Submit, handleVerifyRetryStep1,
  handleVerifyStep2Button, handleVerifyStep2Submit, handleVerifyRetryStep2,
  handleVerifyStep3Button, handleVerifyStep3Submit, handleVerifyRetryStep3, handleVerifyPlayerSelect,
} = require('./verification-handlers');
const { handleEmbedButton, handleEmbedModalSubmit } = require('./embed-builder-handlers');
const {
  handleRegisterTeamButton, handleUseOldTeam, handleUseOldTeamContinue, handleRegGroupSelect,
  handleEditTeam, handleChangeSlotButton,
  handleChangeSlotGroupSelect, handleNewTeam,
  handleManageMatchesButton, handleCancelSlotConfirmButton, handleCancelSlotAbortButton, handleCancelSlotExecuteButton,
  handleRegStep1Submit, handleRegRetryStep1, handleRegStep2Button, handleRegStep2Submit,
  handleRegRetryStep2, handleRegStep3Button, handleRegStep3Submit, handleRegRetryStep3,
  handleRegSelectPlayers, handleRegConfirmRegister, handleRegCancelRegister,
} = require('./register-handlers');
const { handleScrimWizardButton, handleScrimCreateModalSubmit, handleScrimEditModalSubmit } = require('./scrim-wizard-handlers');
const { startLivePanelDayRollover } = require('./live-panel-handlers');
const { startScrimsBanExpiry, startScrimsBanRoleWatcher } = require('./punish-handlers');
const {
  handleTournamentWizardButton, handleTournamentCreateModalSubmit, handleAddGroupModalSubmit,
  handleQualifySelect,
} = require('./tournament-wizard-handlers');
const {
  handleIdPanelButton, handleIdPanelModalSubmit, handleIdPanelChannelSelect,
} = require('./id-panel-handlers');
const {
  handleTeamPanelButton, handleTeamPanelModalSubmit,
} = require('./team-panel-handlers');
const {
  handleGroupScheduleSelect, handleGroupScheduleModalSubmit,
} = require('./group-schedule-handlers');
const { handlePunishSelect } = require('./punish-handlers');
const {
  handleGroupAdminButton, handleGroupAdminResultModalSubmit,
} = require('./group-admin-handlers');
const { relayDmReply } = require('./dm-relay');
const { getAIReply } = require('./ai-chat');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
});
client.commands = new Collection();
client.prefixCommands = new Collection();

// All slash command files live in this same folder, named cmd-*.js
// (flat structure so nothing needs a subfolder — mobile-upload friendly)
const commandFiles = fs.readdirSync(__dirname).filter(f => f.startsWith('cmd-') && f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(__dirname, file));
  client.commands.set(command.data.name, command);
}

// Prefix (!command) files live here too, named pcmd-*.js
const prefixCommandFiles = fs.readdirSync(__dirname).filter(f => f.startsWith('pcmd-') && f.endsWith('.js'));

for (const file of prefixCommandFiles) {
  const command = require(path.join(__dirname, file));
  client.prefixCommands.set(command.name, command);
  for (const alias of command.aliases || []) {
    client.prefixCommands.set(alias, command);
  }
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Loaded ${client.commands.size} commands.`);
  console.log(`Currently in ${client.guilds.cache.size} server(s).`);

  // Custom status pill shown next to the bot's name on its profile card —
  // type Custom with only `state` set (no `name`) renders as plain text,
  // matching the "discohook.app/guide"-style status seen on other bots.
  client.user.setPresence({
    activities: [{
      name: 'Custom Status', // required by the library but not displayed for Custom type
      state: '🔥BGMI Scrims 24x7', // <-- edit this to whatever text you want shown
      type: ActivityType.Custom,
    }],
    status: 'online',
  });

  // Keeps the live panel's "next match day" flipping over on its own at
  // midnight IST, even if nobody happens to register right at that moment.
  startLivePanelDayRollover(client);

  // Lifts "Scrims Ban" roles automatically once their 2-day window is up.
  startScrimsBanExpiry(client);

  // Whenever anyone gains the "Scrims Ban" role — through the punish panel,
  // or an admin manually assigning it in Discord — strip their group
  // role(s) and remove them from their scrim slot(s) right away.
  startScrimsBanRoleWatcher(client);

  // Register slash commands with Discord on every startup. This means a
  // platform that only runs `npm start` (Railway, Render, etc.) still gets
  // commands registered — you don't have to separately run `npm run deploy`.
  // Skipped automatically if CLIENT_ID isn't set.
  //
  // Commands are registered per-guild (once for EVERY server the bot is
  // currently in), not just a single GUILD_ID — otherwise adding the bot to
  // a second server would leave it with no commands there at all, since
  // guild commands only exist in the guild they were registered to.
  if (process.env.CLIENT_ID) {
    const commandData = client.commands.map(c => c.data.toJSON());
    const rest = new REST().setToken(process.env.DISCORD_TOKEN);

    // Clear any leftover GLOBAL commands from earlier deploys. We only
    // register per-guild now, so stale global versions of the same command
    // names can linger and conflict with the guild versions — sometimes
    // surfacing as confusing client-side errors (e.g. "specified channel ID
    // is invalid") that have nothing to do with the actual command logic.
    try {
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });
      console.log('Cleared any leftover global commands.');
    } catch (err) {
      console.error('Failed to clear global commands:', err);
    }

    let successCount = 0;
    for (const guild of client.guilds.cache.values()) {
      try {
        await rest.put(
          Routes.applicationGuildCommands(process.env.CLIENT_ID, guild.id),
          { body: commandData }
        );
        successCount++;
      } catch (err) {
        console.error(`Failed to register commands in guild ${guild.id} (${guild.name}):`, err);
      }
    }
    console.log(`Registered ${commandData.length} commands in ${successCount}/${client.guilds.cache.size} server(s).`);
  } else {
    console.warn('CLIENT_ID not set — skipping automatic slash command registration.');
  }
});

// Whenever the bot is invited into a new server, register commands there
// immediately — so you never have to redeploy or run anything manually
// after adding the bot to a new server.
client.on('guildCreate', async (guild) => {
  if (!process.env.CLIENT_ID) return;
  try {
    const commandData = client.commands.map(c => c.data.toJSON());
    const rest = new REST().setToken(process.env.DISCORD_TOKEN);
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, guild.id),
      { body: commandData }
    );
    console.log(`Joined new server "${guild.name}" — registered ${commandData.length} commands there.`);
  } catch (err) {
    console.error(`Failed to register commands in new guild ${guild.id} (${guild.name}):`, err);
  }
});

// Detects "ping shady/owner/developer" style requests and sends a real,
// notification-triggering mention — the AI can only ever produce plain
// text (it has no way to know a real Discord user ID), so this has to be
// handled directly with the actual ID instead of left to the AI.
// Set OWNER_ID in your .env to your own Discord user ID for this to work.
const PING_OWNER_REGEX = /^\s*ping[.!?]?\s*$|\bping\s+(shady|owner|dev|developer|creator|him|her|them)\b/i;

async function tryHandlePingOwner(message, cleanContent) {
  if (!PING_OWNER_REGEX.test(cleanContent)) return false;

  const ownerId = process.env.OWNER_ID;
  if (!ownerId) {
    console.warn('[ping-owner] OWNER_ID not set in .env — skipping.');
    return false; // falls through to the AI, which will just answer in text
  }

  await message.reply({
    content: `<@${ownerId}>`,
    allowedMentions: { users: [ownerId] },
  });
  return true;
}

// Detects requests like "list Verified role members", "who has @Group A",
// "give me a list of girls and boys" and answers them straight from
// Discord's real member/role data — never routed through the AI, since the
// AI has no visibility into actual role membership and would otherwise just
// hallucinate plausible-looking fake names.
//
// Roles are resolved three ways, combined:
//   1) actual @role mention(s) — most reliable, always honored
//   2) a plain-text role name found in the message (e.g. "Verified")
//   3) gender wording ("girls"/"boys"/"male"/"female"/etc.) matched against
//      whichever of your server's roles look gender-related by name, so it
//      works whether your roles are literally called "Girls"/"Boys",
//      "Male"/"Female", or similar — no exact wording required.
// Multiple roles can be returned at once (e.g. "girls and boys" -> two
// separate lists in one reply). Returns true if it handled (and replied
// to) the message, false if this wasn't a role-list request at all — so
// the caller falls through to the AI.
const GENDER_WORD_GROUPS = [
  { trigger: /\b(girl|girls|female|females|lady|ladies|woman|women)\b/i, roleMatch: ['girl', 'female', 'lady', 'ladies', 'woman', 'women'] },
  { trigger: /\b(boy|boys|male|males|man|men|guy|guys)\b/i, roleMatch: ['boy', 'male', 'man', 'men', 'guy'] },
];

function findMatchingRoles(guild, cleanContent, mentionedRoles) {
  const found = new Map(); // roleId -> role, dedup

  for (const r of mentionedRoles) found.set(r.id, r);

  const allRoles = [...guild.roles.cache.values()].filter(r => r.name !== '@everyone');
  const lower = cleanContent.toLowerCase();

  // Gender wording — pull in every role that looks like it belongs to
  // whichever group(s) were mentioned in the message.
  for (const group of GENDER_WORD_GROUPS) {
    if (!group.trigger.test(cleanContent)) continue;
    for (const r of allRoles) {
      const roleName = r.name.toLowerCase();
      if (group.roleMatch.some(m => roleName.includes(m))) found.set(r.id, r);
    }
  }

  // Plain-text exact role name (e.g. "Verified", "Group A") — only if
  // nothing matched yet, longest name first so specific names win over
  // broader ones that happen to be a substring.
  if (found.size === 0) {
    const sorted = [...allRoles].sort((a, b) => b.name.length - a.name.length);
    const match = sorted.find(r => lower.includes(r.name.toLowerCase()));
    if (match) found.set(match.id, match);
  }

  return [...found.values()];
}

async function tryHandleRoleListRequest(message, cleanContent) {
  const listIntentRegex = /\b(list|show|who\s*has|who\s*have|give me|members?\s+with)\b/i;
  if (!listIntentRegex.test(cleanContent)) return false;

  const roles = findMatchingRoles(message.guild, cleanContent, [...message.mentions.roles.values()]);
  if (roles.length === 0) return false; // looked like a list request, but no role we could pin down — let the AI handle/clarify

  try {
    await message.guild.members.fetch(); // populate the member cache (Server Members Intent is already enabled)
  } catch (err) {
    console.error('[role-list] Failed to fetch guild members:', err);
  }

  const sections = roles.map(role => {
    const all = [...role.members.values()];
    if (all.length === 0) return `**${role.name}** — no one currently has this role.`;
    // Random sample of up to 10 each time there are more members than
    // that, so asking again doesn't always return the identical list.
    const picked = all.length <= 10 ? all : all.sort(() => Math.random() - 0.5).slice(0, 10);
    const lines = picked.map(m => `• ${m}`).join('\n');
    return `**${role.name}** — showing ${picked.length} of ${all.length}:\n${lines}`;
  });

  await message.reply(sections.join('\n\n'));
  return true;
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (!message.guild) {
    // A DM, not a server message — see if it's a reply to something /dm sent.
    await relayDmReply(message, client);
    return;
  }

  // AI helper: replies like a human, but ONLY when someone is actually
  // talking to the bot — either @mentioning it, or replying directly to
  // one of its own earlier messages (so a back-and-forth doesn't need a
  // fresh @mention every time). It deliberately does NOT reply to every
  // message in the AI channel anymore — that used to talk over normal
  // conversations between members, which is exactly what this avoids.
  const prefix = process.env.PREFIX || '!';
  const looksLikePrefixCommand = message.content.startsWith(prefix);

  const mentionsBot = message.mentions.has(client.user);
  const isReplyToBot = message.reference?.messageId
    ? await message.channel.messages.fetch(message.reference.messageId)
        .then(referenced => referenced.author.id === client.user.id)
        .catch(() => false)
    : false;

  if (!looksLikePrefixCommand && (mentionsBot || isReplyToBot)) {
    // Strip the literal @BotName mention text out of the message before
    // sending it off, so the model sees a clean sentence.
    const cleanContent = message.content.replace(/<@!?\d+>/g, '').trim();
    if (cleanContent) {
      try {
        // "Ping shady/owner/developer" — real mention, handled directly
        // (see comment above tryHandlePingOwner for why this can't go
        // through the AI).
        const handledAsPingOwner = await tryHandlePingOwner(message, cleanContent);
        if (handledAsPingOwner) return;

        // "List/show/who has <role>" requests are handled directly against
        // the real member list instead of going to the AI — the AI has no
        // way to know who's actually in a role, so letting it "answer"
        // this would just mean it invents fake names. This path is
        // deterministic and always reflects the live role membership.
        const handledAsRoleList = await tryHandleRoleListRequest(message, cleanContent);
        if (handledAsRoleList) return;

        await message.channel.sendTyping();
        const reply = await getAIReply({
          guildId: message.guild.id,
          guildName: message.guild.name,
          channelId: message.channelId,
          userDisplayName: message.member?.displayName || message.author.username,
          userMessage: cleanContent,
        });
        if (reply) {
          // Discord messages cap at 2000 chars — split just in case a
          // reply runs long instead of letting it silently fail to send.
          const chunks = reply.match(/[\s\S]{1,1900}/g) || [reply];
          for (const chunk of chunks) {
            await message.reply(chunk);
          }
        }
      } catch (err) {
        console.error('Error generating AI reply:', err);
      }
    }
    return;
  }

  if (!looksLikePrefixCommand) return;

  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const commandName = args.shift().toLowerCase();
  if (!commandName) return;

  const command = client.prefixCommands.get(commandName);
  if (!command) return;

  if (command.adminOnly && !message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return message.reply('❌ You need the **Manage Server** permission to use this command.').catch(() => {});
  }

  try {
    await command.execute(message, args);
  } catch (err) {
    console.error(`Error running prefix command "${commandName}":`, err);
    message.reply('❌ Something went wrong running that command.').catch(() => {});
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.guildId) {
    if (interaction.isRepliable()) {
      return interaction.reply({ content: 'This bot only works inside a server.', flags: MessageFlags.Ephemeral });
    }
    return;
  }

  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
    } else if (interaction.isButton()) {
      if (interaction.customId === 'scrim_register_start') {
        await handleRegisterButton(interaction);
      } else if (interaction.customId === 'scrim_register_continue_2') {
        await handleStep2Button(interaction);
      } else if (interaction.customId === 'scrim_register_continue_3') {
        await handleStep3Button(interaction);
      } else if (interaction.customId === 'verify_start') {
        await handleVerifyButton(interaction);
      } else if (interaction.customId === 'verify_edit_start') {
        await handleVerifyEditButton(interaction);
      } else if (interaction.customId === 'verify_continue_2') {
        await handleVerifyStep2Button(interaction);
      } else if (interaction.customId === 'verify_continue_3') {
        await handleVerifyStep3Button(interaction);
      } else if (interaction.customId === 'verify_retry_step1') {
        await handleVerifyRetryStep1(interaction);
      } else if (interaction.customId === 'verify_retry_step2') {
        await handleVerifyRetryStep2(interaction);
      } else if (interaction.customId === 'verify_retry_step3') {
        await handleVerifyRetryStep3(interaction);
      } else if (interaction.customId.startsWith('embed_')) {
        await handleEmbedButton(interaction);
      } else if (interaction.customId === 'register_team_start') {
        await handleRegisterTeamButton(interaction);
      } else if (interaction.customId === 'register_change_slot') {
        await handleChangeSlotButton(interaction);
      } else if (interaction.customId.startsWith('group_change_slot:')) {
        await handleManageMatchesButton(interaction);
      } else if (interaction.customId === 'register_manage_matches') {
        await handleManageMatchesButton(interaction);
      } else if (interaction.customId === 'register_cancel_slot_confirm') {
        await handleCancelSlotConfirmButton(interaction);
      } else if (interaction.customId === 'register_cancel_slot_abort') {
        await handleCancelSlotAbortButton(interaction);
      } else if (interaction.customId === 'register_cancel_slot_execute') {
        await handleCancelSlotExecuteButton(interaction);
      } else if (interaction.customId === 'register_use_old') {
        await handleUseOldTeam(interaction);
      } else if (interaction.customId === 'reg_use_old_continue') {
        await handleUseOldTeamContinue(interaction);
      } else if (interaction.customId === 'register_edit_team') {
        await handleEditTeam(interaction);
      } else if (interaction.customId === 'register_new_team') {
        await handleNewTeam(interaction);
      } else if (interaction.customId === 'reg_continue_2') {
        await handleRegStep2Button(interaction);
      } else if (interaction.customId === 'reg_continue_3') {
        await handleRegStep3Button(interaction);
      } else if (interaction.customId === 'reg_retry_step1') {
        await handleRegRetryStep1(interaction);
      } else if (interaction.customId === 'reg_retry_step2') {
        await handleRegRetryStep2(interaction);
      } else if (interaction.customId === 'reg_retry_step3') {
        await handleRegRetryStep3(interaction);
      } else if (interaction.customId === 'reg_confirm_register') {
        await handleRegConfirmRegister(interaction);
      } else if (interaction.customId === 'reg_cancel_register') {
        await handleRegCancelRegister(interaction);
      } else if (interaction.customId.startsWith('scrim_wizard_')) {
        await handleScrimWizardButton(interaction);
      } else if (interaction.customId.startsWith('tourney_wizard_')) {
        await handleTournamentWizardButton(interaction);
      } else if (interaction.customId === 'idpanel_send') {
        await handleIdPanelButton(interaction);
      } else if (interaction.customId.startsWith('team_panel_')) {
        await handleTeamPanelButton(interaction);
      } else if (interaction.customId.startsWith('group_admin_')) {
        await handleGroupAdminButton(interaction);
      }
    } else if (interaction.isStringSelectMenu() || interaction.isUserSelectMenu()) {
      if (interaction.customId === 'verify_select_players') {
        await handleVerifyPlayerSelect(interaction);
      } else if (interaction.customId === 'reg_select_players') {
        await handleRegSelectPlayers(interaction);
      } else if (interaction.customId === 'change_slot_group_select') {
        await handleChangeSlotGroupSelect(interaction);
      } else if (interaction.customId === 'reg_select_group') {
        await handleRegGroupSelect(interaction);
      } else if (interaction.customId.startsWith('qualify_select_teams:')) {
        await handleQualifySelect(interaction);
      } else if (interaction.customId === 'group_schedule_select') {
        await handleGroupScheduleSelect(interaction);
      } else if (interaction.customId.startsWith('punish_select_teams:')) {
        await handlePunishSelect(interaction);
      }
    } else if (interaction.isChannelSelectMenu()) {
      if (interaction.customId === 'idpanel_channel_select') {
        await handleIdPanelChannelSelect(interaction);
      }
    } else if (interaction.isModalSubmit()) {
      if (interaction.customId === 'scrim_reg_step1') await handleStep1Submit(interaction);
      else if (interaction.customId === 'scrim_reg_step2') await handleStep2Submit(interaction);
      else if (interaction.customId === 'scrim_reg_step3') await handleStep3Submit(interaction);
      else if (interaction.customId === 'verify_step1') await handleVerifyStep1Submit(interaction);
      else if (interaction.customId === 'verify_step2') await handleVerifyStep2Submit(interaction);
      else if (interaction.customId === 'verify_step3') await handleVerifyStep3Submit(interaction);
      else if (interaction.customId.startsWith('embed_modal_')) await handleEmbedModalSubmit(interaction);
      else if (interaction.customId === 'reg_step1') await handleRegStep1Submit(interaction);
      else if (interaction.customId === 'reg_step2') await handleRegStep2Submit(interaction);
      else if (interaction.customId === 'reg_step3') await handleRegStep3Submit(interaction);
      else if (interaction.customId === 'scrim_wizard_create_modal') await handleScrimCreateModalSubmit(interaction);
      else if (interaction.customId === 'scrim_wizard_edit_modal') await handleScrimEditModalSubmit(interaction);
      else if (interaction.customId === 'tourney_wizard_create_modal') await handleTournamentCreateModalSubmit(interaction);
      else if (interaction.customId === 'tourney_wizard_group_modal') await handleAddGroupModalSubmit(interaction);
      else if (interaction.customId === 'idpanel_modal') await handleIdPanelModalSubmit(interaction);
      else if (interaction.customId === 'team_panel_modal') await handleTeamPanelModalSubmit(interaction);
      else if (interaction.customId.startsWith('group_schedule_modal:')) await handleGroupScheduleModalSubmit(interaction);
      else if (interaction.customId.startsWith('group_admin_result_modal:')) await handleGroupAdminResultModalSubmit(interaction);
    }
  } catch (err) {
    console.error(`Error handling interaction (${interaction.type}):`, err);
    const payload = { content: '❌ Something went wrong. Please try again.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else if (interaction.isRepliable()) {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error('Failed to log in to Discord:', err);
  process.exit(1);
});

// Without these, a login/gateway failure or a bug in an event handler can
// fail completely silently in a hosted environment — the process just sits
// there "Active" with no further logs, which is exactly what was happening.
client.on('error', (err) => console.error('Discord client error:', err));
client.on('shardError', (err) => console.error('Discord shard error:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));
