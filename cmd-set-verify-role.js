const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-verify-role')
    .setDescription('Choose the role automatically given to players when they verify their team')
    .addRoleOption(opt =>
      opt.setName('role')
        .setDescription('The role to give on verification')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const role = interaction.options.getRole('role');

    if (role.managed) {
      return interaction.reply({
        content: '❌ That role is managed by an integration (e.g. a bot or booster role) and can\'t be assigned manually. Pick a regular role instead.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const botMember = interaction.guild.members.me;
    if (role.position >= botMember.roles.highest.position) {
      return interaction.reply({
        content: `❌ I can't assign **${role.name}** — it's positioned above my highest role. Move my bot's role above it in Server Settings → Roles.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const store = getGuildStore(interaction.guildId);
    if (!store.settings) store.settings = {};
    store.settings.verifiedRoleId = role.id;
    saveGuildStore(interaction.guildId, store);

    await interaction.reply({
      content: `✅ Players will now automatically get ${role} when they verify their team.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
