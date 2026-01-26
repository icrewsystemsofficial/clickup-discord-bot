require('dotenv').config();

const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder 
} = require('discord.js');

const { getTask, getComments } = require('./services/clickup');

// Validate required environment variables
const requiredEnvVars = ['DISCORD_TOKEN', 'CLICKUP_API_TOKEN'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

// Create Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Validate task ID format (ClickUp task IDs are typically alphanumeric)
function isValidTaskId(taskId) {
  return taskId && typeof taskId === 'string' && taskId.trim().length > 0;
}

// Handle task command
async function handleTaskCommand(interaction) {
  await interaction.deferReply();
  
  const taskId = interaction.options.getString('task_id');
  
  if (!isValidTaskId(taskId)) {
    return interaction.editReply({
      content: 'Invalid task ID. Please provide a valid ClickUp task ID.',
    });
  }
  
  const task = await getTask(taskId.trim());
  
  if (!task || !task.name) {
    return interaction.editReply({
      content: 'Task not found. Please check the task ID and try again.',
    });
  }
  
  const embed = new EmbedBuilder()
    .setTitle(task.name || 'Untitled Task')
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
      content: 'Invalid task ID. Please provide a valid ClickUp task ID.',
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
  const errorMessage = error.response?.status === 404
    ? '⚠️ Task not found. Please check the task ID and try again.'
    : error.response?.status === 401
    ? '⚠️ Authentication failed. Please check API credentials.'
    : error.response?.status === 403
    ? '⚠️ Access denied. Please check permissions.'
    : error.code === 'ECONNABORTED' || error.message?.includes('timeout')
    ? '⚠️ Request timed out. Please try again later.'
    : '⚠️ Failed to fetch ClickUp data. Please try again later.';
  
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({ content: errorMessage });
  }
  return interaction.reply({ content: errorMessage, ephemeral: true });
}

// Ready event handler
client.once('ready', () => {
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
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'clickup-task') {
      await handleTaskCommand(interaction);
    } else if (interaction.commandName === 'clickup-comment') {
      await handleCommentCommand(interaction);
    }
  } catch (error) {
    console.error(`Error handling ${interaction.commandName} command:`, {
      error: error.message,
      stack: error.stack,
      taskId: interaction.options?.getString('task_id'),
      userId: interaction.user?.id,
      guildId: interaction.guildId,
    });
    handleError(interaction, error);
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
