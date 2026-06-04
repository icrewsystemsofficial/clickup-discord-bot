const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');

const { getTask, getComments } = require('./services/clickup');
const { answerNaturalLanguageQuestion } = require('./services/aiAgent');
const { getSopDetails } = require('./services/cerebro');

// Validate required environment variables
const requiredEnvVars = ['DISCORD_TOKEN', 'CLICKUP_API_TOKEN'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

// Create Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function stripBotMention(content, botUserId) {
  return content
    .replace(new RegExp(`<@!?${botUserId}>`, 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getMentionedUsers(message) {
  return message.mentions.users
    .filter((user) => user.id !== message.client.user.id)
    .map((user) => {
      const member = message.guild?.members.cache.get(user.id);
      return {
        id: user.id,
        username: user.username,
        displayName: member?.displayName || user.globalName || user.username,
      };
    });
}

function getDiscordIdsFromText(text) {
  return [...new Set([...text.matchAll(/<@!?(\d{15,25})>/g)].map((match) => match[1]))];
}

function getUniqueDiscordIds(values) {
  const ids = new Set();

  values.forEach((value) => {
    const match = String(value || '').match(/\d{15,25}/);
    if (match) ids.add(match[0]);
  });

  return [...ids].slice(0, 100);
}

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return payload ? [payload] : [];
}

function wantsSopDropdown(question) {
  return /\b(sop|procedure|policy)\b/i.test(question) &&
    /\b(all|list|dropdown|select|show)\b/i.test(question);
}

function buildSopSelectMenu(sops) {
  const options = sops
    .filter((sop) => sop.key && sop.title)
    .slice(0, 25)
    .map((sop) => ({
      label: String(sop.title).slice(0, 100),
      description: String(sop.url ? 'Cabinet link available' : 'No Cabinet link configured').slice(0, 100),
      value: String(sop.key).slice(0, 100),
    }));

  if (!options.length) return [];

  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('sop_select')
        .setPlaceholder('Select an SOP')
        .addOptions(options)
    ),
  ];
}

async function replyWithSopDropdown(message) {
  const data = await getSopDetails();
  const sops = asArray(data);
  const components = buildSopSelectMenu(sops);

  if (!components.length) {
    await message.reply('No SOP details found.');
    return true;
  }

  await message.reply({
    content: 'Select an SOP to get the Cabinet link.',
    components,
    allowedMentions: { parse: [] },
  });
  return true;
}

async function handleSopSelect(interaction) {
  const selectedKey = interaction.values?.[0];
  const data = await getSopDetails();
  const sop = asArray(data).find((item) => item.key === selectedKey);

  if (!sop) {
    await interaction.reply({
      content: 'I could not find that SOP anymore. Please ask for the SOP list again.',
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: sop.url
      ? `**${sop.title}**\n${sop.url}`
      : `**${sop.title}**\nNo Cabinet link is configured for this SOP.`,
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
}

async function handleBotMention(message) {
  if (!message.mentions.has(client.user)) return;

  const question = stripBotMention(message.content, client.user.id);

  if (!question) {
    await message.reply(
      'Ask me about attendance, clock-in details, ClickUp tasks, or SOP details.'
    );
    return;
  }

  await message.channel.sendTyping();

  if (wantsSopDropdown(question)) {
    await replyWithSopDropdown(message);
    return;
  }

  const requesterMember = message.guild?.members.cache.get(message.author.id);
  const answer = await answerNaturalLanguageQuestion({
    question,
    requester: {
      id: message.author.id,
      username: message.author.username,
      displayName:
        requesterMember?.displayName ||
        message.author.globalName ||
        message.author.username,
    },
    mentionedUsers: getMentionedUsers(message),
  });
  const allowedUserIds = getUniqueDiscordIds([
    message.author.id,
    ...getMentionedUsers(message).map((user) => user.id),
    ...getDiscordIdsFromText(answer),
  ]);

  await message.reply({
    content: answer,
    allowedMentions: {
      parse: [],
      users: allowedUserIds,
    },
  });
}

// Validate task ID format (ClickUp task IDs are alphanumeric, e.g. "8xdfdjbgd")
function isValidTaskId(taskId) {
  if (!taskId || typeof taskId !== 'string') return false;
  const trimmed = taskId.trim();
  if (trimmed.length < 2) return false;
  return /^[a-zA-Z0-9_-]+$/.test(trimmed);
}

// Handle task command
async function handleTaskCommand(interaction) {
  await interaction.deferReply();
  
  const taskId = interaction.options.getString('task_id');
  
  if (!isValidTaskId(taskId)) {
    return interaction.editReply({
      content: '**Invalid task ID.** Please provide a valid ClickUp task ID (e.g. alphanumeric, like `8xdfdjbgd`).',
    });
  }

  const task = await getTask(taskId.trim());

  if (!task || !task.name) {
    return interaction.editReply({
      content: '**Task not found.** No task exists with that ID. Please check the task ID and try again.',
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(task.name)
    .setURL(task.url || null)
    .addFields(
      { name: 'Status', value: task.status?.status || 'Unknown', inline: true }
    );
  
  return interaction.editReply({ embeds: [embed] });
}

// Handle comment command
async function handleCommentCommand(interaction) {
  await interaction.deferReply();
  
  const taskId = interaction.options.getString('task_id');
  
  if (!isValidTaskId(taskId)) {
    return interaction.editReply({
      content: '**Invalid task ID.** Please provide a valid ClickUp task ID (e.g. alphanumeric, like `8xdfdjbgd`).',
    });
  }

  const comments = await getComments(taskId.trim());

  if (!comments || !comments.length) {
    return interaction.editReply({
      content: 'No comments found for this task.',
    });
  }
  
  const comment = comments[0];
  
  if (!comment || !comment.comment_text) {
    return interaction.editReply({
      content: 'No valid comments found for this task.',
    });
  }
  
  const embed = new EmbedBuilder()
    .setAuthor({ name: comment.user?.username || 'Unknown User' })
    .setDescription(comment.comment_text.slice(0, 400))
    .setFooter({ text: 'Latest Comment' });
  
  return interaction.editReply({ embeds: [embed] });
}

// Handle errors with appropriate user messages
function handleError(interaction, error) {
  const status = error.status ?? error.response?.status;
  const errorMessage =
    status === 404
      ? '**Task not found.** No task exists with that ID. Please check the task ID and try again.'
      : status === 400 || error.message === 'Invalid task ID'
      ? '**Invalid task ID.** The task ID format is invalid or not recognized by ClickUp. Please provide a valid task ID.'
      : status === 401
      ? '**Authentication failed.** Please check API credentials.'
      : status === 403
      ? '**Access denied.** Please check permissions.'
      : error.code === 'ECONNABORTED' || error.message?.includes('timeout')
      ? '**Request timed out.** Please try again later.'
      : '**Failed to fetch ClickUp data.** Please try again later.';

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({ content: errorMessage });
  }
  return interaction.reply({ content: errorMessage, ephemeral: true });
}

// Ready event handler
client.once('clientReady', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`✅ Bot is ready! Serving ${client.guilds.cache.size} guild(s)`);
});

// Error event handler
client.on('error', (error) => {
  console.error('Discord client error:', error);
});

// Warn event handler
client.on('warn', (warning) => {
  console.warn('Discord client warning:', warning);
});

// Interaction handler
client.on('interactionCreate', async (interaction) => {
  if (interaction.isStringSelectMenu()) {
    try {
      if (interaction.customId === 'sop_select') {
        await handleSopSelect(interaction);
      }
    } catch (error) {
      console.error('Error handling SOP select menu:', {
        error: error.message,
        userId: interaction.user?.id,
        guildId: interaction.guildId,
      });

      const reply = {
        content: 'I could not fetch that SOP link right now. Please try again later.',
        ephemeral: true,
      };

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(reply);
      } else {
        await interaction.reply(reply);
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'clickup-task') {
      await handleTaskCommand(interaction);
    } else if (interaction.commandName === 'clickup-comment') {
      await handleCommentCommand(interaction);
    }
  } catch (error) {
    const status = error.status ?? error.response?.status;
    const isExpectedUserError = status === 404 || status === 400;

    if (isExpectedUserError) {
      console.warn(
        `[${interaction.commandName}] Task not found or invalid ID:`,
        { taskId: interaction.options?.getString('task_id'), status }
      );
    } else {
      console.error(`Error handling ${interaction.commandName} command:`, {
        error: error.message,
        stack: error.stack,
        taskId: interaction.options?.getString('task_id'),
        userId: interaction.user?.id,
        guildId: interaction.guildId,
      });
    }

    try {
      await handleError(interaction, error);
    } catch (replyError) {
      console.error('Failed to send error reply to user:', replyError.message);
    }
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !client.user) return;

  try {
    await handleBotMention(message);
  } catch (error) {
    const status = error.status ?? error.response?.status;
    const isAuthError = status === 401 || status === 403;
    const isConfigError = error.message?.includes('CEREBRO_AI_AGENT_TOKEN');

    console.error('Error handling bot mention:', {
      error: error.message,
      status,
      userId: message.author?.id,
      guildId: message.guildId,
    });

    await message.reply(
      isConfigError
        ? 'CEREBRO_AI_AGENT_TOKEN is missing. Please add it to the bot environment.'
        : isAuthError
        ? 'I could not access the Cerebro AI Agent API. Please check the API token and permissions.'
        : 'I could not fetch those details right now. Please try again later.'
    );
  }
});

// Graceful shutdown handlers
process.on('SIGINT', () => {
  console.log('\n⚠️ Received SIGINT, shutting down gracefully...');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n⚠️ Received SIGTERM, shutting down gracefully...');
  client.destroy();
  process.exit(0);
});

// Unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  client.destroy();
  process.exit(1);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error('Failed to login to Discord:', error);
  process.exit(1);
});
