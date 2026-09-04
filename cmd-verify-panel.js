const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify-panel')
    .setDescription('Post the team verification panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('📝 Team Verification')
      .setColor(0xF5A623)
      .setDescription(
        ':emoji_189: 𝐒𝐂𝐑𝐈𝐌𝐒 𝐕𝐄𝐑𝐈𝐅𝐈𝐂𝐀𝐓𝐈𝐎𝐍

𝑹𝒆𝒂𝒅𝒚 𝒕𝒐 𝒆𝒏𝒕𝒆𝒓 𝒕𝒉𝒆 𝒍𝒐𝒃𝒃𝒚? 𝑽𝒆𝒓𝒊𝒇𝒚 𝒚𝒐𝒖𝒓 𝒔𝒒𝒖𝒂𝒅 𝒂𝒏𝒅 𝒍𝒐𝒄𝒌 𝒚𝒐𝒖𝒓 𝒔𝒑𝒐𝒕 𝒃𝒆𝒇𝒐𝒓𝒆 𝒕𝒉𝒆 𝒔𝒍𝒐𝒕𝒔 𝒓𝒖𝒏 𝒐𝒖𝒕! :emoji_188:

𝑽𝑬𝑹𝑰𝑭𝑰𝑪𝑨𝑻𝑰𝑶𝑵 𝑺𝑻𝑬𝑷𝑺

① 𝑷𝒓𝒆𝒔𝒔 𝑽𝑬𝑹𝑰𝑭𝒀 𝑯𝑬𝑹𝑬 𝒃𝒆𝒍𝒐𝒘
② 𝑨𝒅𝒅 𝒚𝒐𝒖𝒓 𝑻𝒆𝒂𝒎 𝑫𝒆𝒕𝒂𝒊𝒍𝒔 
③ 𝑺𝒆𝒍𝒆𝒄𝒕 𝒚𝒐𝒖𝒓 4 𝒑𝒍𝒂𝒚𝒊𝒏𝒈 𝒎𝒆𝒎𝒃𝒆𝒓𝒔
④ 𝑺𝒖𝒃𝒎𝒊𝒕 & 𝒔𝒆𝒄𝒖𝒓𝒆 𝒚𝒐𝒖𝒓 𝒔𝒍𝒐𝒕

:emoji_26: Everʏ field is required

━━━━━━━━━━━━━━━━━━━━━━
:emoji_182: 𝗡𝗢𝗕𝗟𝗘 𝗚𝗔𝗠𝗜𝗡𝗚 • 𝗦𝗖𝗥𝗜𝗠𝗦'
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('verify_start')
        .setLabel('Verify')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('verify_edit_start')
        .setLabel('Edit')
        .setEmoji('✏️')
        .setStyle(ButtonStyle.Secondary)
    );

    // channel.send instead of interaction.reply — no "used /verify-panel"
    // attribution line above a panel players will click for a long time.
    await interaction.channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ content: '✅ Panel posted.', flags: MessageFlags.Ephemeral });
  },
};
