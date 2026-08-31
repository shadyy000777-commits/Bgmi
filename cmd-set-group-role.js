const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');

// Group 1-12 map onto the internal letters A-L used everywhere else in the
// codebase (GROUP_SCHEDULE, scrim.slots[i].group, etc.) — this command is
// just the numbered-facing way admins configure them.
const GROUP_CHOICES = Array.from({ length: 12 }, (_, i) => ({
  name: `Group ${i + 1}`,
  value: String.fromCharCode(65 + i), // 'A'..'L'
}));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-group-role')
    .setDescription('Choose the role automatically given to players assigned to a specific group')
    .addIntegerOption(opt =>
      opt.setName('group')
        .setDescription('Which group this role is for')
        .setRequired(true)
        .addChoices(...GROUP_CHOICES.map((g, i) => ({ name: g.name, value: i + 1 }))))
    .addRoleOption(opt =>
      opt.setName('role')
        .setDescription('The role to give players in this group')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const groupNumber = interaction.options.getInteger('group');
    const role = interaction.options.getRole('role');
    const groupLetter = String.fromCharCode(64 + groupNumber); // 1 -> 'A', 2 -> 'B', ...

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
    if (!store.settings.groupRoles) store.settings.groupRoles = {};
    store.settings.groupRoles[groupLetter] = role.id;
    saveGuildStore(interaction.guildId, store);

    await interaction.reply({
      content: `✅ Players assigned to **Group ${groupNumber}** will now automatically get ${role}. If they later switch to a different group via **Change Slot**, this role is swapped out for the new group's role.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
