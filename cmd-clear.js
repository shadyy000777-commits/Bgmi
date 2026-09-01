const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Bulk delete recent messages in this channel')
    .addIntegerOption(opt =>
      opt.setName('amount').setDescription('Number of messages to delete (1-1000)').setRequired(true).setMinValue(1).setMaxValue(1000))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const amount = interaction.options.getInteger('amount');
    // Discord's bulkDelete API caps at 100 messages per call regardless of
    // what we ask for, so anything above that has to be done in batches.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let remaining = amount;
    let totalDeleted = 0;
    let stoppedEarly = false;

    while (remaining > 0) {
      const batchSize = Math.min(remaining, 100);
      let batchDeleted;
      try {
        batchDeleted = await interaction.channel.bulkDelete(batchSize, true);
      } catch (err) {
        console.error('Error bulk deleting messages:', err);
        stoppedEarly = true;
        break;
      }

      totalDeleted += batchDeleted.size;
      remaining -= batchSize;

      // bulkDelete silently skips messages older than 14 days, so a batch
      // coming back smaller than requested means there's nothing left it
      // can touch — stop instead of looping until amount is hit.
      if (batchDeleted.size < batchSize) {
        stoppedEarly = true;
        break;
      }

      if (remaining > 0) {
        await new Promise(res => setTimeout(res, 1000)); // brief pause between batches to stay clear of rate limits
      }
    }

    const note = stoppedEarly
      ? ' (stopped early — Discord can\'t bulk-delete messages older than 14 days, or the channel ran out of messages.)'
      : '';
    await interaction.editReply({ content: `🧹 Deleted **${totalDeleted}** message(s).${note}` });
  },
};
