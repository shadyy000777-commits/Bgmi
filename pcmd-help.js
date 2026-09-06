const { PermissionsBitField } = require('discord.js');

const SHORT_DESC_MAX = 70;

// Full descriptions carry usage syntax ("— usage: !open <group>") meant for
// error messages, not a scannable list — strip that off and cap the length
// so every row in !help stays a single short line.
function shortDescription(desc) {
  if (!desc) return 'No description provided.';
  let short = desc
    .split(/\s+—\s+usage:/i)[0]
    .split(/\s*\(usage:/i)[0]
    .trim();
  if (short.length > SHORT_DESC_MAX) {
    short = short.slice(0, SHORT_DESC_MAX).replace(/\s+\S*$/, '') + '…';
  }
  return short;
}

// Discord messages cap at 2000 chars. Each code block costs 8 chars for the
// ```/``` fences plus their own newlines, so keep a safety margin and split
// into multiple code blocks/messages if a section runs long.
const MAX_BLOCK_CHARS = 1900;

function buildCodeBlocks(lines) {
  const blocks = [];
  let current = [];
  let currentLen = 0;

  for (const line of lines) {
    // +1 for the newline that will join this line to the block
    if (current.length && currentLen + line.length + 1 > MAX_BLOCK_CHARS) {
      blocks.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(line);
    currentLen += line.length + 1;
  }
  if (current.length) blocks.push(current);

  return blocks.map(group => '```\n' + group.join('\n') + '\n```');
}

async function sendSection(channel, header, entries) {
  if (!entries.length) return;

  // Pad every command name to the widest one in this section so
  // descriptions line up in a neat column, same idea as the numbered
  // slot list this format is modeled on.
  const nameWidth = Math.max(...entries.map(e => e.name.length));
  const lines = entries.map(e => `${e.name.padEnd(nameWidth)}  ${e.desc}`);

  const blocks = buildCodeBlocks(lines);
  for (let i = 0; i < blocks.length; i++) {
    const title = blocks.length > 1 ? `**${header} (${i + 1}/${blocks.length})**` : `**${header}**`;
    await channel.send(`${title}\n${blocks[i]}`);
  }
}

module.exports = {
  name: 'help',
  aliases: ['commands', 'cmds'],
  description: 'Show every prefix and slash command and what it does',
  adminOnly: false,

  async execute(message) {
    const prefix = process.env.PREFIX || '!';

    // client.prefixCommands has each command registered once per name AND
    // once per alias (so lookups are O(1)) — dedupe back down to the
    // unique command objects before listing.
    const uniquePrefix = [...new Set(message.client.prefixCommands.values())]
      .sort((a, b) => a.name.localeCompare(b.name));

    const slashCommands = [...message.client.commands.values()]
      .sort((a, b) => a.data.name.localeCompare(b.data.name));

    const prefixEntries = uniquePrefix.map(cmd => {
      const aliasText = cmd.aliases && cmd.aliases.length
        ? ` (${cmd.aliases.map(a => `${prefix}${a}`).join(', ')})`
        : '';
      return {
        name: `${cmd.adminOnly ? '* ' : '  '}${prefix}${cmd.name}${aliasText}`,
        desc: shortDescription(cmd.description),
      };
    });

    const slashEntries = slashCommands.map(cmd => {
      const json = cmd.data.toJSON();
      // default_member_permissions is a stringified bitfield, or null/undefined
      // for a command anyone can run — mirrors the * = Manage Server convention
      // already used for prefix commands.
      const isAdminOnly = json.default_member_permissions
        && new PermissionsBitField(BigInt(json.default_member_permissions)).has(PermissionsBitField.Flags.ManageGuild);
      return {
        name: `${isAdminOnly ? '* ' : '  '}/${json.name}`,
        desc: shortDescription(json.description),
      };
    });

    await message.channel.send(
      `📖 **${slashEntries.length + prefixEntries.length}** command(s) available. \`*\` = requires **Manage Server**.`
    );
    await sendSection(message.channel, `📜 Slash Commands (${slashEntries.length})`, slashEntries);
    await sendSection(message.channel, `📜 Prefix Commands (${prefixEntries.length})`, prefixEntries);
  },
};
