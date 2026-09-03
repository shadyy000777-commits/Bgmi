const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');

// The role given to slot owners when an admin submits a group's placement
// via the "Result" button on the group admin panel (see
// group-admin-handlers.js). One role shared across every group — e.g. a
// "Qualified" or "Finalist" role — not a per-group role.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-result-role')
    .setDescription('Choose the role given to teams entered as a match result (via the Result button)')
    .addRoleOption(opt =>
      opt.setName('role')
        .setDescription('The role to give to 1st/2nd place team owners')
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
    store.settings.resultRoleId = role.id;
    saveGuildStore(interaction.guildId, store);

    await interaction.reply({
      content: `✅ Teams entered via the **Result** button will now get ${role}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
