require('dotenv').config();

const { REST, Routes, SlashCommandBuilder } = require('discord.js');

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

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  await rest.put(
    Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
    { body: commands }
  );
  console.log('✅ Slash commands registered');
})();