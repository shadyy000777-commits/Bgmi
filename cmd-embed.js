const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');
const { buildPanelPayload } = require('./embed-builder-handlers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Build a custom embed with an interactive editor, like Mimu')
    .addSubcommand(sub =>
      sub.setName('create')
        .setDescription('Start a new embed draft')
        .addStringOption(opt =>
          opt.setName('name').setDescription('A short name to identify this embed').setRequired(true).setMaxLength(50)))
    .addSubcommand(sub =>
      sub.setName('delete')
        .setDescription('Permanently delete an embed draft')
        .addStringOption(opt =>
          opt.setName('name').setDescription('The embed to delete').setRequired(true).setMaxLength(50)))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const store = getGuildStore(interaction.guildId);
    if (!store.embeds) store.embeds = {};

    if (sub === 'create') {
      const name = interaction.options.getString('name').trim();

      if (store.embeds[name]) {
        return interaction.reply({
          content: `❌ An embed named **${name}** already exists. Pick a different name, or delete it first with \`/embed delete name:${name}\`.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      store.embeds[name] = {};
      saveGuildStore(interaction.guildId, store);

      return interaction.reply({ ...buildPanelPayload(name, store.embeds[name]), flags: MessageFlags.Ephemeral });
    }

    if (sub === 'delete') {
      const name = interaction.options.getString('name').trim();
      if (!store.embeds[name]) {
        return interaction.reply({
          content: `❌ No embed draft named **${name}**.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      delete store.embeds[name];
      saveGuildStore(interaction.guildId, store);
      return interaction.reply({ content: `🗑️ Deleted embed draft **${name}**.`, flags: MessageFlags.Ephemeral });
    }
  },
};
