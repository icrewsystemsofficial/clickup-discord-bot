const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });

const { REST, Routes, SlashCommandBuilder } = require('discord.js');

// Validate required environment variables
const requiredEnvVars = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

// Define slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('clickup-task')
    .setDescription('Fetch ClickUp task details')
    .addStringOption(opt =>
      opt.setName('task_id')
        .setDescription('ClickUp Task ID')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('clickup-comment')
    .setDescription('Fetch latest ClickUp task comments')
    .addStringOption(opt =>
      opt.setName('task_id')
        .setDescription('ClickUp Task ID')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('icrew-help')
    .setDescription('Show what the Icrew agent can do'),
  new SlashCommandBuilder()
    .setName('icrew-debug')
    .setDescription('Check the bot permissions in this channel')
].map(cmd => cmd.toJSON());

// Create REST client
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
const guildIds = (process.env.DISCORD_GUILD_IDS || process.env.DISCORD_GUILD_ID || '')
  .split(',')
  .map((guildId) => guildId.trim())
  .filter(Boolean);

// Register commands
(async () => {
  try {
    if (guildIds.length) {
      console.log(`Registering slash commands for ${guildIds.length} guild(s)...`);

      for (const guildId of guildIds) {
        const data = await rest.put(
          Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId),
          { body: commands }
        );

        console.log(`Successfully registered ${data.length} slash command(s) for guild ${guildId}:`);
        data.forEach(cmd => console.log(`   - /${cmd.name}`));
      }

      return;
    }

    console.log('Registering global slash commands...');

    const data = await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: commands }
    );

    console.log(`Successfully registered ${data.length} global slash command(s):`);
    data.forEach(cmd => console.log(`   - /${cmd.name}`));
    console.log('Global slash commands can take time to appear in every server. Set DISCORD_GUILD_ID for instant server registration.');
  } catch (error) {
    console.error('Failed to register slash commands:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
})();
