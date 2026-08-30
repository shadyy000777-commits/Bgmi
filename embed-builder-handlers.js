const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { getGuildStore, saveGuildStore } = require('./storage');

const HEX_RE = /^#?[0-9A-Fa-f]{6}$/;
const URL_RE = /^https?:\/\/\S+$/i;

function isValidUrl(value) {
  return !value || URL_RE.test(value);
}

function isValidColor(value) {
  return !value || HEX_RE.test(value);
}

// customIds carry the draft's name after a colon, e.g. "embed_edit_basic:my-embed",
// since multiple named drafts can exist at once and buttons need to know which one.
function withName(prefix, name) {
  return `${prefix}:${name}`;
}
function splitCustomId(customId) {
  const idx = customId.indexOf(':');
  return { prefix: customId.slice(0, idx), name: customId.slice(idx + 1) };
}

function buildPreviewEmbed(data) {
  const embed = new EmbedBuilder();
  if (data.title) embed.setTitle(data.title);
  if (data.description) embed.setDescription(data.description);
  embed.setColor(data.color ? parseInt(data.color.replace('#', ''), 16) : 0x2B2D31);
  if (data.url) embed.setURL(data.url);
  if (data.image) embed.setImage(data.image);
  if (data.thumbnail) embed.setThumbnail(data.thumbnail);
  if (data.authorName) {
    embed.setAuthor({ name: data.authorName, iconURL: data.authorIcon || undefined, url: data.authorUrl || undefined });
  }
  if (data.footerText) {
    embed.setFooter({ text: data.footerText, iconURL: data.footerIcon || undefined });
  }
  if (data.fields && data.fields.length) embed.addFields(data.fields);

  if (!data.title && !data.description && !(data.fields && data.fields.length) && !data.image) {
    embed.setDescription('*(empty — use the buttons below to add content)*');
  }
  return embed;
}

function buildPanelComponents(name) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(withName('embed_edit_basic', name)).setLabel('Basic Info').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(withName('embed_edit_author', name)).setLabel('Author').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(withName('embed_edit_footer', name)).setLabel('Footer').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(withName('embed_edit_images', name)).setLabel('Images').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(withName('embed_edit_fields', name)).setLabel('Fields').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(withName('embed_send', name)).setLabel('Send').setEmoji('📤').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(withName('embed_delete', name)).setLabel('Delete').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
  );
  return [row1, row2];
}

function buildPanelPayload(name, data) {
  return {
    content: `Editing embed **${name}** — changes save as you go. Only you can see this.`,
    embeds: [buildPreviewEmbed(data)],
    components: buildPanelComponents(name),
  };
}

// Reusable fields->string / string->fields for the Fields modal, so admins
// can add multiple name/value pairs without needing 25 separate options.
// Format: "Name1 | Value1 ; Name2 | Value2 ; ..."
function fieldsToRaw(fields) {
  if (!fields || !fields.length) return '';
  return fields.map(f => `${f.name} | ${f.value}`).join(' ; ');
}
function parseFieldsRaw(raw) {
  if (!raw || !raw.trim()) return { fields: [], error: null };
  const segments = raw.split(';').map(s => s.trim()).filter(Boolean);
  const fields = [];
  for (const segment of segments) {
    const splitIndex = segment.indexOf('|');
    if (splitIndex === -1) {
      return { fields: [], error: `❌ Couldn't parse \`${segment}\` — use the format \`Name | Value\`, separated by \`;\`.` };
    }
    const name = segment.slice(0, splitIndex).trim();
    const value = segment.slice(splitIndex + 1).trim();
    if (!name || !value) {
      return { fields: [], error: `❌ \`${segment}\` is missing a name or value.` };
    }
    fields.push({ name: name.slice(0, 256), value: value.slice(0, 1024) });
  }
  if (fields.length > 25) return { fields: [], error: '❌ Embeds can have at most 25 fields.' };
  return { fields, error: null };
}

// --- Modal builders (prefilled with current draft values) ---

function buildBasicModal(name, data) {
  const modal = new ModalBuilder().setCustomId(withName('embed_modal_basic', name)).setTitle('Edit Basic Info');
  const title = new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256);
  if (data.title) title.setValue(data.title);
  const description = new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(4000);
  if (data.description) description.setValue(data.description);
  const color = new TextInputBuilder().setCustomId('color').setLabel('Color (hex, e.g. #F5A623)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(7);
  if (data.color) color.setValue(data.color);
  const url = new TextInputBuilder().setCustomId('url').setLabel('Title URL (makes title clickable)').setStyle(TextInputStyle.Short).setRequired(false);
  if (data.url) url.setValue(data.url);

  modal.addComponents(
    new ActionRowBuilder().addComponents(title),
    new ActionRowBuilder().addComponents(description),
    new ActionRowBuilder().addComponents(color),
    new ActionRowBuilder().addComponents(url),
  );
  return modal;
}

function buildAuthorModal(name, data) {
  const modal = new ModalBuilder().setCustomId(withName('embed_modal_author', name)).setTitle('Edit Author');
  const authorName = new TextInputBuilder().setCustomId('author_name').setLabel('Author Name').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256);
  if (data.authorName) authorName.setValue(data.authorName);
  const authorIcon = new TextInputBuilder().setCustomId('author_icon').setLabel('Author Icon URL').setStyle(TextInputStyle.Short).setRequired(false);
  if (data.authorIcon) authorIcon.setValue(data.authorIcon);
  const authorUrl = new TextInputBuilder().setCustomId('author_url').setLabel('Author URL (clicking name goes here)').setStyle(TextInputStyle.Short).setRequired(false);
  if (data.authorUrl) authorUrl.setValue(data.authorUrl);

  modal.addComponents(
    new ActionRowBuilder().addComponents(authorName),
    new ActionRowBuilder().addComponents(authorIcon),
    new ActionRowBuilder().addComponents(authorUrl),
  );
  return modal;
}

function buildFooterModal(name, data) {
  const modal = new ModalBuilder().setCustomId(withName('embed_modal_footer', name)).setTitle('Edit Footer');
  const footerText = new TextInputBuilder().setCustomId('footer_text').setLabel('Footer Text').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(2048);
  if (data.footerText) footerText.setValue(data.footerText);
  const footerIcon = new TextInputBuilder().setCustomId('footer_icon').setLabel('Footer Icon URL').setStyle(TextInputStyle.Short).setRequired(false);
  if (data.footerIcon) footerIcon.setValue(data.footerIcon);

  modal.addComponents(
    new ActionRowBuilder().addComponents(footerText),
    new ActionRowBuilder().addComponents(footerIcon),
  );
  return modal;
}

function buildImagesModal(name, data) {
  const modal = new ModalBuilder().setCustomId(withName('embed_modal_images', name)).setTitle('Edit Images');
  const image = new TextInputBuilder().setCustomId('image').setLabel('Large Image URL').setStyle(TextInputStyle.Short).setRequired(false);
  if (data.image) image.setValue(data.image);
  const thumbnail = new TextInputBuilder().setCustomId('thumbnail').setLabel('Thumbnail URL (small, top-right)').setStyle(TextInputStyle.Short).setRequired(false);
  if (data.thumbnail) thumbnail.setValue(data.thumbnail);

  modal.addComponents(
    new ActionRowBuilder().addComponents(image),
    new ActionRowBuilder().addComponents(thumbnail),
  );
  return modal;
}

function buildFieldsModal(name, data) {
  const modal = new ModalBuilder().setCustomId(withName('embed_modal_fields', name)).setTitle('Edit Fields');
  const fieldsInput = new TextInputBuilder()
    .setCustomId('fields_raw')
    .setLabel('Fields: Name | Value ; Name2 | Value2')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(4000);
  const existing = fieldsToRaw(data.fields);
  if (existing) fieldsInput.setValue(existing);

  modal.addComponents(new ActionRowBuilder().addComponents(fieldsInput));
  return modal;
}

// --- Button handlers ---

async function handleEmbedButton(interaction) {
  const { prefix, name } = splitCustomId(interaction.customId);
  const store = getGuildStore(interaction.guildId);
  const data = store.embeds && store.embeds[name];

  if (!data) {
    return interaction.reply({
      content: `❌ Embed draft **${name}** no longer exists (maybe it was deleted). Run \`/embed create\` to start a new one.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (prefix === 'embed_edit_basic') return interaction.showModal(buildBasicModal(name, data));
  if (prefix === 'embed_edit_author') return interaction.showModal(buildAuthorModal(name, data));
  if (prefix === 'embed_edit_footer') return interaction.showModal(buildFooterModal(name, data));
  if (prefix === 'embed_edit_images') return interaction.showModal(buildImagesModal(name, data));
  if (prefix === 'embed_edit_fields') return interaction.showModal(buildFieldsModal(name, data));

  if (prefix === 'embed_send') {
    if (!data.title && !data.description && !(data.fields && data.fields.length)) {
      return interaction.reply({
        content: '❌ This embed is still empty — add at least a title, description, or fields before sending.',
        flags: MessageFlags.Ephemeral,
      });
    }
    try {
      await interaction.channel.send({ embeds: [buildPreviewEmbed(data)] });
    } catch (err) {
      console.error('Failed to send embed draft:', err);
      return interaction.reply({
        content: '❌ Couldn\'t post that — check your image/icon URLs are valid, or I might be missing permissions here.',
        flags: MessageFlags.Ephemeral,
      });
    }
    return interaction.reply({ content: `✅ Sent **${name}** to this channel.`, flags: MessageFlags.Ephemeral });
  }

  if (prefix === 'embed_delete') {
    delete store.embeds[name];
    saveGuildStore(interaction.guildId, store);
    return interaction.update({
      content: `🗑️ Deleted embed draft **${name}**.`,
      embeds: [],
      components: [],
    });
  }
}

// --- Modal submit handlers ---

async function handleEmbedModalSubmit(interaction) {
  const { prefix, name } = splitCustomId(interaction.customId);
  const store = getGuildStore(interaction.guildId);
  if (!store.embeds) store.embeds = {};
  const data = store.embeds[name];

  if (!data) {
    return interaction.reply({
      content: `❌ Embed draft **${name}** no longer exists. Run \`/embed create\` to start a new one.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (prefix === 'embed_modal_basic') {
    const title = interaction.fields.getTextInputValue('title').trim();
    const description = interaction.fields.getTextInputValue('description').trim();
    const color = interaction.fields.getTextInputValue('color').trim();
    const url = interaction.fields.getTextInputValue('url').trim();

    if (!isValidColor(color)) {
      return interaction.reply({ content: '❌ Color has to be a hex code like `#F5A623`.', flags: MessageFlags.Ephemeral });
    }
    if (!isValidUrl(url)) {
      return interaction.reply({ content: '❌ Title URL doesn\'t look valid (must start with http:// or https://).', flags: MessageFlags.Ephemeral });
    }
    if (url && !title) {
      return interaction.reply({ content: '❌ Title URL needs a title to attach to.', flags: MessageFlags.Ephemeral });
    }

    data.title = title || undefined;
    data.description = description || undefined;
    data.color = color || undefined;
    data.url = url || undefined;
  }

  if (prefix === 'embed_modal_author') {
    const authorName = interaction.fields.getTextInputValue('author_name').trim();
    const authorIcon = interaction.fields.getTextInputValue('author_icon').trim();
    const authorUrl = interaction.fields.getTextInputValue('author_url').trim();

    if (!isValidUrl(authorIcon) || !isValidUrl(authorUrl)) {
      return interaction.reply({ content: '❌ One of those URLs doesn\'t look valid (must start with http:// or https://).', flags: MessageFlags.Ephemeral });
    }

    data.authorName = authorName || undefined;
    data.authorIcon = authorIcon || undefined;
    data.authorUrl = authorUrl || undefined;
  }

  if (prefix === 'embed_modal_footer') {
    const footerText = interaction.fields.getTextInputValue('footer_text').trim();
    const footerIcon = interaction.fields.getTextInputValue('footer_icon').trim();

    if (!isValidUrl(footerIcon)) {
      return interaction.reply({ content: '❌ Footer icon URL doesn\'t look valid (must start with http:// or https://).', flags: MessageFlags.Ephemeral });
    }

    data.footerText = footerText || undefined;
    data.footerIcon = footerIcon || undefined;
  }

  if (prefix === 'embed_modal_images') {
    const image = interaction.fields.getTextInputValue('image').trim();
    const thumbnail = interaction.fields.getTextInputValue('thumbnail').trim();

    if (!isValidUrl(image) || !isValidUrl(thumbnail)) {
      return interaction.reply({ content: '❌ One of those URLs doesn\'t look valid (must start with http:// or https://).', flags: MessageFlags.Ephemeral });
    }

    data.image = image || undefined;
    data.thumbnail = thumbnail || undefined;
  }

  if (prefix === 'embed_modal_fields') {
    const raw = interaction.fields.getTextInputValue('fields_raw').trim();
    const { fields, error } = parseFieldsRaw(raw);
    if (error) {
      return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
    }
    data.fields = fields;
  }

  saveGuildStore(interaction.guildId, store);

  await interaction.update(buildPanelPayload(name, data));
}

module.exports = {
  buildPreviewEmbed,
  buildPanelPayload,
  handleEmbedButton,
  handleEmbedModalSubmit,
};
