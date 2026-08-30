require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, MessageFlags, REST, Routes } = require('discord.js');
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
  handleRegisterTeamButton, handleUseOldTeam, handleEditTeam, handleNewTeam,
  handleRegStep1Submit, handleRegRetryStep1, handleRegStep2Button, handleRegStep2Submit,
  handleRegRetryStep2, handleRegStep3Button, handleRegStep3Submit, handleRegRetryStep3,
  handleRegSelectPlayers,
} = require('./register-handlers');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

// All command files live in this same folder, named cmd-*.js
// (flat structure so nothing needs a subfolder — mobile-upload friendly)
const commandFiles = fs.readdirSync(__dirname).filter(f => f.startsWith('cmd-') && f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(__dirname, file));
  client.commands.set(command.data.name, command);
}

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Loaded ${client.commands.size} commands.`);
  console.log(`Currently in ${client.guilds.cache.size} server(s).`);

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
      } else if (interaction.customId === 'register_use_old') {
        await handleUseOldTeam(interaction);
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
      }
    } else if (interaction.isStringSelectMenu() || interaction.isUserSelectMenu()) {
      if (interaction.customId === 'verify_select_players') {
        await handleVerifyPlayerSelect(interaction);
      } else if (interaction.customId === 'reg_select_players') {
        await handleRegSelectPlayers(interaction);
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

client.login(process.env.DISCORD_TOKEN);
