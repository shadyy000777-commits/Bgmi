const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dm')
    .setDescription('Send a private message to a player on this server')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('The player to message')
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('message')
        .setDescription('What to send them')
        .setRequired(true)
        .setMaxLength(2000))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user');
    const message = interaction.options.getString('message');

    // Confirm they're actually a member of this server, not just any Discord user.
    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      return interaction.reply({
        content: '❌ That user isn\'t a member of this server.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (targetUser.bot) {
      return interaction.reply({
        content: '❌ Can\'t DM a bot.',
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      await targetUser.send({ content: message });
    } catch (err) {
      console.error(`Failed to DM ${targetUser.tag}:`, err);
      return interaction.reply({
        content: `❌ Couldn't DM ${targetUser} — they likely have DMs from server members disabled.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Ephemeral so the DM's contents aren't posted publicly in the channel —
    // only the moderator running the command sees this confirmation.
    await interaction.reply({
      content: `✅ Sent a DM to ${targetUser}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
