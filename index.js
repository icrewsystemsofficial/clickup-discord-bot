require('dotenv').config();

const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder 
} = require('discord.js');

const { getTask, getComments } = require('./services/clickup');

// 1️⃣ CREATE CLIENT (THIS WAS MISSING)
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// 2️⃣ READY EVENT
client.once('clientReady', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// 3️⃣ INTERACTION HANDLER
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    // /clickup-task
    if (interaction.commandName === 'clickup-task') {
        await interaction.deferReply(); // 🔥 REQUIRED
      
        const taskId = interaction.options.getString('task_id');
        const task = await getTask(taskId);
      
        const embed = new EmbedBuilder()
          .setTitle(task.name)
          .setURL(task.url)
          .addFields(
            { name: 'Status', value: task.status?.status || 'Unknown', inline: true },
            { name: 'Priority', value: task.priority?.priority || 'None', inline: true },
            {
              name: 'Assignee',
              value: task.assignees?.length
                ? task.assignees.map(a => a.username).join(', ')
                : 'Unassigned',
              inline: true
            }
          )
          .setDescription(task.description?.slice(0, 300) || 'No description');
      
        return interaction.editReply({ embeds: [embed] });
      }
      

    // /clickup-comment
    if (interaction.commandName === 'clickup-comment') {
        await interaction.deferReply();
      
        const taskId = interaction.options.getString('task_id');
        const comments = await getComments(taskId);
      
        if (!comments.length) {
          return interaction.editReply('No comments found.');
        }
      
        const comment = comments[0];
      
        const embed = new EmbedBuilder()
          .setAuthor({ name: comment.user.username })
          .setDescription(comment.comment_text.slice(0, 400))
          .setFooter({ text: 'Latest Comment' });
      
        return interaction.editReply({ embeds: [embed] });
      }
      

  } catch (err) {
    console.error(err);
    return interaction.reply({
      content: '⚠️ Failed to fetch ClickUp data. Check Task ID or permissions.',
      ephemeral: true,
    });
  }
});

// 4️⃣ LOGIN (ALWAYS LAST)
client.login(process.env.DISCORD_TOKEN);
