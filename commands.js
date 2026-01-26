require('dotenv').config();

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
    )
].map(cmd => cmd.toJSON());

// Create REST client
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// Register commands
(async () => {
  try {
    console.log('Registering slash commands...');
    
    const data = await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: commands }
    );
    
    console.log(`Successfully registered ${data.length} slash command(s):`);
    data.forEach(cmd => console.log(`   - /${cmd.name}`));
  } catch (error) {
    console.error('Failed to register slash commands:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
})();