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
        'ℂ𝕝𝕚𝕔𝕜 𝕥𝕙𝕖 𝕓𝕦𝕥𝕥𝕠𝕟 𝕓𝕖𝕝𝕠𝕨 𝕥𝕠 𝕣𝕖𝕘𝕚𝕤𝕥𝕖𝕣 𝕪𝕠𝕦𝕣 𝕥𝕖𝕒𝕞 𝕗𝕠𝕣 𝕥𝕙𝕖 𝕤𝕔𝕣𝕚𝕞.\n\n' +
        "Alreadʏ verified thrᎧuɢh `/verify-panel`? ʏᎧu'll be able tᎧ reuse ʏᎧur saved team prᎧfile — " +
        'nᎧ need tᎧ retʏpe everʏthinɢ.\n\n' +
        '𝗥𝗲𝗴𝗶𝘀𝘁𝗿𝗮𝘁𝗶𝗼𝗻 𝗶𝘀 𝗼𝗽𝗲𝗻 𝟮𝟰/𝟳 — 𝗻𝗼 𝗻𝗲𝗲𝗱 𝘁𝗼 𝘄𝗮𝗶𝘁 𝗳𝗼𝗿 𝗮𝗻𝘆𝘁𝗵𝗶𝗻𝗴 𝘁𝗼 𝗼𝗽𝗲𝗻.'
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
