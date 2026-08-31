const { 
  SlashCommandBuilder, 
  PermissionFlagsBits, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle 
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('post-idp')
    .setDescription('Post Room ID & Password panel for qualified teams')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(option => 
      option.setName('room_id')
        .setDescription('BGMI Custom Room ID')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('password')
        .setDescription('BGMI Custom Room Password')
        .setRequired(true))
    .addRoleOption(option => 
      option.setName('allowed_role')
        .setDescription('Role required to view credentials')
        .setRequired(true)),

  async execute(interaction) {
    const roomId = interaction.options.getString('room_id');
    const password = interaction.options.getString('password');
    const allowedRole = interaction.options.getRole('allowed_role');

    // Create Embed
    const idpEmbed = new EmbedBuilder()
      .setTitle('🔑 BGMI Room ID & Password')
      .setDescription(`Click the button below to view the Room ID and Password.\n\n**Allowed Role:** ${allowedRole}`)
      .setColor('#00FF7F')
      .setFooter({ text: 'Do not share these credentials outside your team!' })
      .setTimestamp();

    // Create Button with Custom ID encoding the credentials securely
    const button = new ButtonBuilder()
      .setCustomId(`reveal_idp:${roomId}:${password}:${allowedRole.id}`)
      .setLabel('Show ID & Pass')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🔓');

    const row = new ActionRowBuilder().addComponents(button);

    await interaction.reply({ embeds: [idpEmbed], components: [row] });
  }
};
