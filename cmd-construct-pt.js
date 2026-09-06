const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { runConstructPt, hasManageGuild } = require('./pt-handlers');

// Discord modals can't take file uploads at all — attachment-type slash
// command options are the one place Discord lets you upload files as part
// of filling in a command, so that's how screenshots get in here instead
// of a button + modal. Up to 5 lobby + 10 result screenshots covers every
// realistic scrim/tournament lobby size while staying under Discord's
// 25-option-per-command cap (1 slotlist + 5 + 10 = 16).

function addAttachmentOptions(builder, prefix, count, requiredCount) {
  for (let i = 1; i <= count; i++) {
    builder.addAttachmentOption(opt =>
      opt.setName(`${prefix}${i}`)
        .setDescription(`${prefix === 'lobby' ? 'Lobby' : 'Result'} screenshot #${i}`)
        .setRequired(i <= requiredCount));
  }
  return builder;
}

let data = new SlashCommandBuilder()
  .setName('construct-pt')
  .setDescription('Build a point table from lobby & result screenshots using AI')
  .addStringOption(opt =>
    opt.setName('slotlist')
      .setDescription('Paste your slot list (optional) — helps the AI match team names correctly')
      .setRequired(false))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

data = addAttachmentOptions(data, 'lobby', 5, 1);
data = addAttachmentOptions(data, 'result', 10, 1);

module.exports = {
  data,

  async execute(interaction) {
    if (!hasManageGuild(interaction)) {
      return interaction.reply({ content: '❌ You need the **Manage Server** permission to do that.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const slotlist = interaction.options.getString('slotlist')?.trim() || '';

    const lobbyUrls = [];
    for (let i = 1; i <= 5; i++) {
      const att = interaction.options.getAttachment(`lobby${i}`);
      if (att) lobbyUrls.push(att.url);
    }

    const resultUrls = [];
    for (let i = 1; i <= 10; i++) {
      const att = interaction.options.getAttachment(`result${i}`);
      if (att) resultUrls.push(att.url);
    }

    await runConstructPt(interaction, { slotlist, lobbyUrls, resultUrls });
  },
};
