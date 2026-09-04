const {
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('register')
    .setDescription('Post the team registration panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('<:emoji_1759633286586:1538873940171038791> 𝐓𝐞𝐚𝐦 𝐑𝐞𝐠𝐢𝐬𝐭𝐫𝐚𝐭𝐢𝐨𝐧')
      .setColor(0x57F287)
      .setDescription(
        '𝑪𝒍𝒊𝒄𝒌 𝒕𝒉𝒆 𝒃𝒖𝒕𝒕𝒐𝒏 𝒃𝒆𝒍𝒐𝒘 𝒕𝒐 𝒓𝒆𝒈𝒊𝒔𝒕𝒆𝒓 𝒚𝒐𝒖𝒓 𝒕𝒆𝒂𝒎 𝒇𝒐𝒓 𝒕𝒉𝒆 𝒔𝒄𝒓𝒊𝒎.\n\n' + 
        "𝑨𝒍𝒓𝒆𝒂𝒅𝒚 𝒗𝒆𝒓𝒊𝒇𝒊𝒆𝒅 𝒕𝒉𝒓𝒐𝒖𝒈𝒉 `/𝒗𝒆𝒓𝒊𝒇𝒚-𝒑𝒂𝒏𝒆𝒍`? 𝒀𝒐𝒖'𝒍𝒍 𝒃𝒆 𝒂𝒃𝒍𝒆 𝒕𝒐 𝒓𝒆𝒖𝒔𝒆 𝒚𝒐𝒖𝒓 𝒔𝒂𝒗𝒆𝒅 𝒕𝒆𝒂𝒎 𝒑𝒓𝒐𝒇𝒊𝒍𝒆 — " + 
        '𝒏𝒐 𝒏𝒆𝒆𝒅 𝒕𝒐 𝒓𝒆𝒕𝒚𝒑𝒆 𝒆𝒗𝒆𝒓𝒚𝒕𝒉𝒊𝒏𝒈.\n\n' + 
        '𝑹𝒆𝒈𝒊𝒔𝒕𝒓𝒂𝒕𝒊𝒐𝒏 𝒊𝒔 𝒐𝒑𝒆𝒏 24/7 — 𝒏𝒐 𝒏𝒆𝒆𝒅 𝒕𝒐 𝒘𝒂𝒊𝒕 𝒇𝒐𝒓 𝒂𝒏𝒚𝒕𝒉𝒊𝒏𝒈 𝒕𝒐 𝒐𝒑𝒆𝒏.'
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('register_team_start')
        .setLabel('Register Team')
        .setEmoji('📥')
        .setStyle(ButtonStyle.Primary)
    );

    // channel.send instead of interaction.reply — no "used /register"
    // attribution line above a panel players will click for a long time.
    await interaction.channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ content: '✅ Panel posted.', flags: MessageFlags.Ephemeral });
  },
};
