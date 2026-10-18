require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, Events, GatewayIntentBits, REST, Routes, SlashCommandBuilder, WebhookClient } = require('discord.js');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID, BT_WEBHOOK_URL } = process.env;
const ADD_SKIN_ROLE_ID = '1476225310021386240'; // Required to use /add-skin
const BUTTON_LOG_CHANNEL_ID = '1489298733895122986';
const FOOTER_ICON = 'https://i.ibb.co/fVYT7mxg/BT.jpg';
const DEFAULT_COLOR = 0x4452bb;
const DATA_FILE = path.join(__dirname, 'skins.json');
if (!DISCORD_TOKEN || !CLIENT_ID || !BT_WEBHOOK_URL) throw new Error('Set DISCORD_TOKEN, CLIENT_ID and BT_WEBHOOK_URL in .env');

function readSkins() {
  try { const value = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  catch (e) { if (e.code !== 'ENOENT') console.error('skins.json read failed:', e); return {}; }
}
function writeSkins(value) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, DATA_FILE);
}
function parseMessageLink(value) {
  let url; try { url = new URL(value); } catch { throw new Error('Provide a valid Discord message link.'); }
  if (!['discord.com', 'www.discord.com', 'canary.discord.com', 'ptb.discord.com'].includes(url.hostname)) throw new Error('Provide a Discord message link.');
  const p = url.pathname.split('/').filter(Boolean);
  if (p.length < 4 || p[0] !== 'channels') throw new Error('Link must look like https://discord.com/channels/SERVER_ID/CHANNEL_ID/MESSAGE_ID');
  return { guildId: p[1], channelId: p[2], messageId: p[3] };
}
function normalizeCode(value) {
  const code = value.trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,50}$/.test(code)) throw new Error('Code can use letters, numbers, underscores and hyphens only.');
  return code;
}

const command = new SlashCommandBuilder().setName('add-skin').setDescription('Publish a Beyond Transit skin.')
  .addStringOption(o => o.setName('code').setDescription('Skin code, e.g. bt_st_race').setRequired(true))
  .addStringOption(o => o.setName('message-link').setDescription('Discord message containing the original downloadable attachment').setRequired(true))
  .addAttachmentOption(o => o.setName('attachment').setDescription('Image shown as the embed main image').setRequired(true))
  .addStringOption(o => o.setName('skin-creator').setDescription('Skin creator').setRequired(true))
  .addStringOption(o => o.setName('name').setDescription('Skin name').setRequired(true))
  .addStringOption(o => o.setName('description').setDescription('Skin description').setRequired(true))
  .addRoleOption(o => o.setName('roles').setDescription('Role required to get this skin').setRequired(true));

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
client.once(Events.ClientReady, async c => {
  console.log(`Logged in as ${c.user.tag}`);
  try {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    const route = GUILD_ID ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID) : Routes.applicationCommands(CLIENT_ID);
    await rest.put(route, { body: [command.toJSON()] });
    console.log('Registered /add-skin.');
  } catch (e) { console.error('Command registration failed:', e); }
});
client.on(Events.InteractionCreate, async i => {
  if (i.isChatInputCommand() && i.commandName === 'add-skin') return addSkin(i);
  if (i.isButton()) {
    // Log every button interaction this bot receives, including buttons it doesn't otherwise process.
    logButtonClick(i).catch(error => console.error('Button click logging failed:', error));
    if (i.customId.startsWith('buy_')) return buySkin(i);
  }
});

async function logButtonClick(i) {
  const channel = await client.channels.fetch(BUTTON_LOG_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased() || !channel.send) {
    console.error('Button log channel is unavailable or not a text channel.');
    return;
  }
  const embed = new EmbedBuilder()
    .setColor(DEFAULT_COLOR)
    .setTitle('Button Clicked')
    .addFields(
      { name: 'User', value: `${i.user.tag} (\`${i.user.id}\`)`, inline: false },
      { name: 'Button ID', value: `\`${String(i.customId).slice(0, 900)}\``, inline: false },
      { name: 'Server', value: i.guild ? `${i.guild.name} (\`${i.guild.id}\`)` : 'DM', inline: true },
      { name: 'Channel', value: i.channel ? `${i.channel.name || 'Unknown'} (\`${i.channel.id}\`)` : 'Unknown', inline: true },
      { name: 'Message ID', value: `\`${i.message.id}\``, inline: true }
    )
    .setTimestamp();
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function addSkin(i) {
  await i.deferReply({ ephemeral: true });
  try {
    if (!i.inGuild()) return i.editReply('Use this command in a server.');
    const member = await i.guild.members.fetch(i.user.id).catch(() => null);
    if (!member || !member.roles.cache.has(ADD_SKIN_ROLE_ID)) {
      return i.editReply('You need the required skin-manager role to use /add-skin.');
    }
    const code = normalizeCode(i.options.getString('code', true));
    const link = parseMessageLink(i.options.getString('message-link', true));
    const image = i.options.getAttachment('attachment', true);
    const creator = i.options.getString('skin-creator', true);
    const name = i.options.getString('name', true);
    const description = i.options.getString('description', true);
    const color = DEFAULT_COLOR;
    const requiredRole = i.options.getRole('roles', true);
    if (link.guildId !== i.guildId) return i.editReply('The source message must be in this server.');
    const sourceChannel = await client.channels.fetch(link.channelId);
    if (!sourceChannel?.isTextBased() || !sourceChannel.messages) return i.editReply('I cannot access that message channel.');
    const sourceMessage = await sourceChannel.messages.fetch(link.messageId);
    const sourceAttachments = [...sourceMessage.attachments.values()];
    if (!sourceAttachments.length) return i.editReply('The linked message has no attachment.');

    const embed = new EmbedBuilder().setColor(color).setAuthor({ name: `SKIN CREATOR : ${creator}` })
      .setTitle(name).setDescription(description).setImage(image.url)
      .setFooter({ text: 'Beyond Transit', iconURL: FOOTER_ICON });
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder()
      .setCustomId(`buy_${code}`).setLabel('Get Skin').setStyle(ButtonStyle.Primary));

    const skins = readSkins();
    const isUpdate = Object.prototype.hasOwnProperty.call(skins, code);
    const existing = isUpdate ? skins[code] : null;
    const skinRecord = { code, creator, name, description, sourceGuildId: link.guildId,
      sourceChannelId: link.channelId, sourceMessageId: link.messageId,
      sourceAttachmentIds: sourceAttachments.map(a => a.id), requiredRoleId: requiredRole.id,
      requiredRoleName: requiredRole.name, publishedBy: i.user.id,
      publishedAt: new Date().toISOString() };

    const webhook = new WebhookClient({ url: BT_WEBHOOK_URL });
    if (isUpdate && existing.webhookMessageId) {
      // Edit the existing published webhook post so the same code updates in place.
      await webhook.editMessage(existing.webhookMessageId, {
        embeds: [embed],
        components: [row],
        allowedMentions: { parse: [] },
      });
      skinRecord.webhookMessageId = existing.webhookMessageId;
    } else {
      // First publication for this code; save the webhook message ID for future updates.
      const sent = await webhook.send({ embeds: [embed], components: [row], allowedMentions: { parse: [] }, withResponse: true });
      skinRecord.webhookMessageId = sent.resource?.message?.id || sent.id || null;
    }

    skins[code] = skinRecord;
    writeSkins(skins);
    return i.editReply(`${isUpdate ? 'Updated' : 'Added'} **${name}** with code \`${code}\`.`);
  } catch (e) { console.error('add-skin failed:', e); return i.editReply(`Could not publish skin: ${e.message || 'Unknown error'}`); }
}

async function buySkin(i) {
  const code = i.customId.slice(4).toLowerCase();
  const skin = readSkins()[code];
  if (!skin) return i.reply({ content: 'Skin not found in the registry. Contact an administrator.', ephemeral: true });
  if (!i.inGuild()) return i.reply({ content: 'Use this button inside the server.', ephemeral: true });
  const member = await i.guild.members.fetch(i.user.id).catch(() => null);
  if (!member || !skin.requiredRoleId || !member.roles.cache.has(skin.requiredRoleId)) {
    return i.reply({ content: `You need the role required for this skin${skin.requiredRoleName ? ` (\u003c@\u0026${skin.requiredRoleId}\u003e)` : ''} to get it.`, ephemeral: true });
  }
  await i.deferReply({ ephemeral: true });
  try {
    const channel = await client.channels.fetch(skin.sourceChannelId);
    if (!channel?.isTextBased() || !channel.messages) throw new Error('The source channel is inaccessible.');
    const message = await channel.messages.fetch(skin.sourceMessageId);
    const attachments = [...message.attachments.values()];
    if (!attachments.length) throw new Error('The source message no longer has any attachments.');
    const files = [];
    for (let index = 0; index < attachments.length; index++) {
      const attachment = attachments[index];
      // Use the freshly fetched attachment URL and download every attachment in the source message.
      const response = await fetch(attachment.url);
      if (!response.ok) throw new Error(`Attachment download failed for ${attachment.name || index + 1} (HTTP ${response.status}).`);
      const buffer = Buffer.from(await response.arrayBuffer());
      files.push(new AttachmentBuilder(buffer, { name: attachment.name || `${code}-${index + 1}` }));
    }
    await i.user.send({ content: `Here are all attachments for **${skin.name}** (\`${code}\`).`,
      files,
      allowedMentions: { parse: [] } });
    return i.editReply('Skin sent to your DMs.');
  } catch (e) {
    console.error(`Delivery failed for ${code}:`, e);
    return i.editReply(e.code === 50007 ? 'I could not DM you. Enable DMs from server members and try again.' : `Could not deliver skin: ${e.message || 'Unknown error'}`);
  }
}
client.login(DISCORD_TOKEN);
