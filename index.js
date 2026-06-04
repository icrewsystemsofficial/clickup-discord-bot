const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const { getTask, getComments } = require('./services/clickup');
const { answerNaturalLanguageQuestion } = require('./services/aiAgent');
const {
  createLoaForDiscordUser,
  getClockInDetails,
  getClickUpTasks,
  getSopDetails,
  scheduleMeeting,
} = require('./services/cerebro');

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

function wantsUserDashboard(question) {
  return /\b(status|dashboard|overview|summary)\b/i.test(question) &&
    !/\b(sop|procedure|policy)\b/i.test(question);
}

function wantsAgentHelp(question) {
  return /\b(help|what can you do|capabilities|commands|agent help|how to use)\b/i.test(question);
}

function wantsClockedInNoTasksAnalytics(question) {
  return /\b(clocked in|clockin|clock-in|attendance)\b/i.test(question) &&
    /\b(no tasks|without tasks|didn'?t.*tasks|not.*tasks|no work|didn'?t really do)\b/i.test(question);
}

function wantsOverdueTeamAnalytics(question) {
  return /\boverdue\b/i.test(question) &&
    /\b(task|tasks|clickup)\b/i.test(question) &&
    /\b(team|department|software|operations|hr|human resources|pr|public relations)\b/i.test(question);
}

function wantsWriteAction(question) {
  return /\b(issue|mark|create|apply|add)\b.*\b(loa|leave|awol)\b/i.test(question) ||
    /\b(schedule|create|book|set up)\b.*\b(meeting|calendar)\b/i.test(question);
}

function wantsLoaAction(question) {
  return /\b(issue|mark|create|apply|add)\b.*\b(loa|leave|awol)\b/i.test(question);
}

function wantsMeetingAction(question) {
  return /\b(schedule|create|book|set up)\b.*\b(meeting|calendar)\b/i.test(question);
}

function extractDurationMinutes(question) {
  const match = question.match(/\b(\d{1,3})\s*(minutes?|mins?|m)\b/i);
  return match ? Number(match[1]) : 30;
}

function extractStartTime(question) {
  const match = question.match(/\b([01]?\d|2[0-3])(?::([0-5]\d))?\s*(am|pm)?\b/i);
  if (!match) return '';

  let hour = Number(match[1]);
  const minute = match[2] || '00';
  const meridiem = match[3]?.toLowerCase();

  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  return `${String(hour).padStart(2, '0')}:${minute}`;
}

function extractEmails(question) {
  return [...new Set(
    [...question.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)]
      .map((match) => match[0].toLowerCase())
  )];
}

function extractDateKeyword(question) {
  const isoDate = question.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (isoDate) return isoDate[0];
  if (/\btoday\b/i.test(question)) return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  if (/\btomorrow\b/i.test(question)) {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }
  return '';
}

function extractMeetingTopic(question) {
  const titleMatch = question.match(/\btitle\s*:\s*["“]?(.+?)["”]?\s*$/i);
  if (titleMatch) return titleMatch[1].trim();

  const quoted = question.match(/["“](.+?)["”]/);
  if (quoted) return quoted[1].trim();

  const match = question.match(/\b(?:about|to talk about|regarding)\s+(.+)$/i);
  return match ? match[1].trim() : 'Meeting scheduled by Icrew AI agent';
}

function getDashboardTarget(message) {
  const mentionedUsers = getMentionedUsers(message);

  if (mentionedUsers.length) {
    return mentionedUsers[0];
  }

  const member = message.guild?.members.cache.get(message.author.id);
  return {
    id: message.author.id,
    username: message.author.username,
    displayName: member?.displayName || message.author.globalName || message.author.username,
  };
}

function countItems(payload) {
  if (Array.isArray(payload)) return payload.length;
  if (Number.isFinite(payload?.count)) return payload.count;
  if (Number.isFinite(payload?.tasks_count)) return payload.tasks_count;
  if (Array.isArray(payload?.data)) return payload.data.length;
  if (Array.isArray(payload?.tasks)) return payload.tasks.length;
  if (Array.isArray(payload?.clock_ins)) return payload.clock_ins.length;
  return 0;
}

function getTaskItems(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.tasks)) return payload.tasks;
  if (Array.isArray(payload)) return payload;
  return [];
}

function getGroupedTaskItems(payload) {
  if (!Array.isArray(payload?.data)) return [];
  return payload.data.map((group) => ({
    user: group.user || group.staff_user,
    count: Number.isFinite(group.count) ? group.count : countItems(group.data || group.tasks),
    tasks: getTaskItems(group),
    error: group.error,
  }));
}

function formatDateTime(value) {
  if (!value) return 'not set';
  if (typeof value === 'number') {
    const date = new Date(value > 9999999999 ? value : value * 1000);
    return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  }
  return String(value);
}

function formatTaskPreview(task, index) {
  const name = task.name || task.title || `Task ${index + 1}`;
  const status = task.status?.status || task.status || 'unknown';
  const due = task.due || task.due_date || task.dueDate;
  const url = task.url || task.link || task.task_url;
  return `- ${name} (${status}, due: ${formatDateTime(due)})${url ? `\n  ${url}` : ''}`;
}

function formatClockDetails(payload, discordId) {
  const records = asArray(payload.clock_ins || payload.records || payload.data);
  const currentClockIn = payload.current_clock_in;
  const isClockedIn = payload.is_clocked_in ? 'currently clocked in' : 'not clocked in now';

  if (!records.length && !currentClockIn) {
    return `Clock-in details for <@${discordId}>\n- No clock-in record found today, ${isClockedIn}`;
  }

  const lines = records.slice(0, 8).map((record) => {
    const inTime = record.in_time || record.clock_in || record.clockIn;
    const outTime = record.out_time || record.clock_out || record.clockOut;
    const duration = record.duration || record.total_hours || record.work_hours;
    return `- in: ${formatDateTime(inTime)}, out: ${formatDateTime(outTime)}${duration ? `, duration: ${duration}` : ''}`;
  });

  return `Clock-in details for <@${discordId}>\n- ${isClockedIn}\n${lines.join('\n')}`;
}

function buildDashboardButtons(discordId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`dashboard:pending:${discordId}`)
        .setLabel('Pending Tasks')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`dashboard:overdue:${discordId}`)
        .setLabel('Overdue Tasks')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`dashboard:clock:${discordId}`)
        .setLabel('Clock-In Details')
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

async function replyWithAgentHelp(message) {
  const embed = new EmbedBuilder()
    .setTitle('Icrew Agent Help')
    .setDescription('Ask me natural-language questions about attendance, ClickUp tasks, SOPs, and staff status.')
    .addFields(
      {
        name: 'Attendance',
        value: [
          '`@Icrew who clocked in today?`',
          '`@Icrew @Santhosh clockin details`',
          '`@Icrew who clocked in today but did not do any tasks?`',
        ].join('\n'),
      },
      {
        name: 'ClickUp Analytics',
        value: [
          '`@Icrew @Santhosh status`',
          '`@Icrew @Santhosh overdue tasks`',
          '`@Icrew how many overdue tasks are there for software team?`',
        ].join('\n'),
      },
      {
        name: 'SOPs',
        value: [
          '`@Icrew password sop url`',
          '`@Icrew show all sop list`',
        ].join('\n'),
      },
      {
        name: 'Action Workflows',
        value: [
          '`@Icrew issue an LoA to Leo today`',
          '`@Icrew schedule a 30 minutes meeting with Akshay about overdue tasks today`',
          'Write actions need Cerebro action APIs and confirmation before changing the database/calendar.',
        ].join('\n'),
      }
    );

  await message.reply({
    embeds: [embed],
    allowedMentions: { parse: [] },
  });
}

async function replyInteractionWithAgentHelp(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('Icrew Agent Help')
    .setDescription('Ask me natural-language questions about attendance, ClickUp tasks, SOPs, and staff status.')
    .addFields(
      {
        name: 'Attendance',
        value: [
          '`@Icrew who clocked in today?`',
          '`@Icrew @Santhosh clockin details`',
          '`@Icrew who clocked in today but did not do any tasks?`',
        ].join('\n'),
      },
      {
        name: 'ClickUp Analytics',
        value: [
          '`@Icrew @Santhosh status`',
          '`@Icrew @Santhosh overdue tasks`',
          '`@Icrew how many overdue tasks are there for software team?`',
        ].join('\n'),
      },
      {
        name: 'SOPs',
        value: [
          '`@Icrew password sop url`',
          '`@Icrew show all sop list`',
        ].join('\n'),
      },
      {
        name: 'Action Workflows',
        value: [
          '`@Icrew issue an LoA to Leo today`',
          '`@Icrew schedule a 30 minutes meeting with Akshay about overdue tasks today`',
          '`@Icrew schedule meeting for one@example.com and two@example.com title: Project update`',
          'Write actions need confirmation-safe Cerebro APIs before changing database/calendar records.',
        ].join('\n'),
      }
    );

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });
}

function matchesTeam(user, question) {
  const lower = question.toLowerCase();
  const text = [
    user?.name,
    user?.first_name,
    user?.last_name,
    user?.email,
    user?.job_title,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const teams = [
    ['software', ['software', 'developer', 'engineer', 'programmer']],
    ['operations', ['operations', 'ops']],
    ['hr', ['hr', 'human resources']],
    ['pr', ['pr', 'public relations']],
  ];

  const selected = teams.find(([team, aliases]) =>
    lower.includes(team) || aliases.some((alias) => lower.includes(alias))
  );

  if (!selected) return true;
  return selected[1].some((alias) => text.includes(alias));
}

async function replyClockedInNoTasksAnalytics(message) {
  const [attendanceData, taskData] = await Promise.all([
    getClockInDetails(),
    getClickUpTasks({ filter: 'today' }),
  ]);

  const taskGroups = getGroupedTaskItems(taskData);
  const taskCountsByUserId = new Map(
    taskGroups.map((group) => [String(group.user?.id || group.user?.discord_id || ''), group.count])
  );
  const taskCountsByDiscordId = new Map(
    taskGroups.map((group) => [String(group.user?.discord_id || ''), group.count])
  );

  const clockedInUsers = asArray(attendanceData).filter((group) =>
    group?.is_clocked_in || Number(group?.clock_ins_count || 0) > 0 || asArray(group?.clock_ins).length > 0
  );

  const noTaskUsers = clockedInUsers.filter((group) => {
    const user = group.user || {};
    const countById = taskCountsByUserId.get(String(user.id));
    const countByDiscord = taskCountsByDiscordId.get(String(user.discord_id));
    return Number(countById || countByDiscord || 0) === 0;
  });

  const lines = noTaskUsers.slice(0, 20).map((group) => {
    const user = group.user || {};
    return `- ${user.discord_id ? `<@${user.discord_id}>` : user.name || 'Unknown user'}: ${group.clock_ins_count || asArray(group.clock_ins).length} clock-in record(s), 0 ClickUp today tasks`;
  });

  await message.reply({
    content: [
      'Clocked in today but no ClickUp today tasks found',
      lines.length ? lines.join('\n') : 'No matching users found.',
      '',
      '_Note: this uses ClickUp tasks due today as the task-activity proxy._',
    ].join('\n').slice(0, 1900),
    allowedMentions: {
      parse: [],
      users: getUniqueDiscordIds(lines),
    },
  });
}

async function replyOverdueTeamAnalytics(message, question) {
  const data = await getClickUpTasks({ filter: 'overdue' });
  const groups = getGroupedTaskItems(data).filter((group) => matchesTeam(group.user, question));
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  const lines = groups
    .filter((group) => group.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)
    .map((group) => {
      const user = group.user || {};
      return `- ${user.discord_id ? `<@${user.discord_id}>` : user.name || 'Unknown user'}: ${group.count}`;
    });

  await message.reply({
    content: [
      `Overdue ClickUp tasks${/\bsoftware\b/i.test(question) ? ' for software team' : ''}: ${total}`,
      lines.length ? lines.join('\n') : 'No overdue tasks found for that team filter.',
    ].join('\n').slice(0, 1900),
    allowedMentions: {
      parse: [],
      users: getUniqueDiscordIds(lines),
    },
  });
}

async function replyWriteActionGuidance(message, question) {
  const isLoa = /\b(loa|leave|awol)\b/i.test(question);
  const isMeeting = /\b(meeting|calendar)\b/i.test(question);
  const lines = [
    'I understand this as an action request.',
  ];

  if (isLoa) {
    lines.push('LoA creation needs a Cerebro write endpoint with approver/leave-type validation before I can safely modify the database.');
  }

  if (isMeeting) {
    lines.push('Meeting scheduling needs a Cerebro action endpoint using a service/calendar credential, because the current meeting flow depends on a web session Google OAuth token.');
  }

  lines.push('I can still help gather the context first, for example overdue tasks and the target user status.');

  await message.reply({
    content: lines.join('\n'),
    allowedMentions: { parse: [] },
  });
}

async function handleLoaAction(message, question) {
  const target = getMentionedUsers(message)[0];

  if (!target) {
    await message.reply({
      content: 'Please mention the user for the LoA, for example `@Icrew issue an LoA to @Santhosh today`.',
      allowedMentions: { parse: [] },
    });
    return;
  }

  const date = extractDateKeyword(question);
  const response = await createLoaForDiscordUser(target.id, {
    requester_discord_id: message.author.id,
    date,
    reason: `Created from Discord by <@${message.author.id}>`,
    status: 'approved',
  });
  const loa = response.data;

  await message.reply({
    content: [
      `LoA ${response.message?.toLowerCase() || 'created'} for <@${target.id}>.`,
      `Date: ${loa.start_date}${loa.end_date !== loa.start_date ? ` to ${loa.end_date}` : ''}`,
      `Status: ${loa.status}`,
      `LoA ID: ${loa.id}`,
    ].join('\n'),
    allowedMentions: { parse: [], users: [target.id] },
  });
}

async function handleMeetingAction(message, question) {
  const mentionedUsers = getMentionedUsers(message);
  const emails = extractEmails(question);

  if (!mentionedUsers.length && !emails.length) {
    await message.reply({
      content: 'Please mention who the meeting is with or provide emails, for example `@Icrew schedule meeting for user@example.com and other@example.com title: Project update`.',
      allowedMentions: { parse: [] },
    });
    return;
  }

  const duration = extractDurationMinutes(question);
  const date = extractDateKeyword(question);
  const startTime = extractStartTime(question);
  const topic = extractMeetingTopic(question);
  const response = await scheduleMeeting({
    requester_discord_id: message.author.id,
    attendee_discord_ids: mentionedUsers.map((user) => user.id),
    attendee_emails: emails,
    date,
    start_time: startTime || undefined,
    duration_minutes: duration,
    title: `Meeting: ${topic}`.slice(0, 255),
    topic,
    include_overdue_tasks: /\boverdue\b/i.test(question),
  });
  const meeting = response.data;
  const targetMentions = mentionedUsers.map((user) => `<@${user.id}>`);
  const targetText = [...targetMentions, ...emails].join(', ');

  await message.reply({
    content: [
      `Meeting scheduled with ${targetText}.`,
      `${meeting.date} ${meeting.start_time}-${meeting.end_time} (${meeting.duration_minutes} minutes)`,
      meeting.task_gist_count ? `Added ${meeting.task_gist_count} overdue-task gist line(s) to the description.` : 'No overdue-task gist was added.',
      meeting.google_event_link ? `Calendar: ${meeting.google_event_link}` : `Google event ID: ${meeting.google_event_id || 'not returned'}`,
    ].join('\n'),
    allowedMentions: { parse: [], users: mentionedUsers.map((user) => user.id) },
  });
}

async function replyWithUserDashboard(message, target) {
  const [clockData, pendingData, overdueData] = await Promise.all([
    getClockInDetails({ discordId: target.id }),
    getClickUpTasks({ discordId: target.id, filter: 'pending' }),
    getClickUpTasks({ discordId: target.id, filter: 'overdue' }),
  ]);

  const clockCount = countItems(clockData.clock_ins ? clockData.clock_ins : clockData);
  const pendingCount = countItems(pendingData);
  const overdueCount = countItems(overdueData);
  const clockStatus = clockData.is_clocked_in ? 'Currently clocked in' : 'Not clocked in now';

  const embed = new EmbedBuilder()
    .setTitle(`Status for ${target.displayName || target.username || target.id}`)
    .setDescription(`<@${target.id}>`)
    .addFields(
      {
        name: 'Attendance',
        value: `${clockStatus}\n${clockCount} clock-in record${clockCount === 1 ? '' : 's'} today`,
        inline: false,
      },
      {
        name: 'ClickUp',
        value: `${pendingCount} pending task${pendingCount === 1 ? '' : 's'}\n${overdueCount} overdue task${overdueCount === 1 ? '' : 's'}`,
        inline: false,
      }
    );

  await message.reply({
    embeds: [embed],
    components: buildDashboardButtons(target.id),
    allowedMentions: { parse: [], users: [target.id] },
  });
}

async function handleDashboardButton(interaction) {
  const [, action, discordId] = interaction.customId.split(':');

  if (!discordId) {
    await interaction.reply({ content: 'Missing dashboard user ID.', ephemeral: true });
    return;
  }

  if (action === 'clock') {
    const data = await getClockInDetails({ discordId });
    await interaction.reply({
      content: formatClockDetails(data, discordId).slice(0, 1900),
      ephemeral: true,
      allowedMentions: { parse: [], users: [discordId] },
    });
    return;
  }

  const filter = action === 'overdue' ? 'overdue' : 'pending';
  const data = await getClickUpTasks({ discordId, filter });
  const tasks = getTaskItems(data);

  await interaction.reply({
    content: (tasks.length
      ? `ClickUp ${filter} tasks for <@${discordId}>\n${tasks.slice(0, 8).map(formatTaskPreview).join('\n')}`
      : `No ClickUp ${filter} tasks found for <@${discordId}>.`).slice(0, 1900),
    ephemeral: true,
    allowedMentions: { parse: [], users: [discordId] },
  });
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

  if (wantsAgentHelp(question)) {
    await replyWithAgentHelp(message);
    return;
  }

  if (wantsSopDropdown(question)) {
    await replyWithSopDropdown(message);
    return;
  }

  if (wantsClockedInNoTasksAnalytics(question)) {
    await replyClockedInNoTasksAnalytics(message);
    return;
  }

  if (wantsOverdueTeamAnalytics(question)) {
    await replyOverdueTeamAnalytics(message, question);
    return;
  }

  if (wantsUserDashboard(question)) {
    await replyWithUserDashboard(message, getDashboardTarget(message));
    return;
  }

  if (wantsLoaAction(question)) {
    await handleLoaAction(message, question);
    return;
  }

  if (wantsMeetingAction(question)) {
    await handleMeetingAction(message, question);
    return;
  }

  if (wantsWriteAction(question)) {
    await replyWriteActionGuidance(message, question);
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
  if (interaction.isButton()) {
    try {
      if (interaction.customId.startsWith('dashboard:')) {
        await handleDashboardButton(interaction);
      }
    } catch (error) {
      console.error('Error handling dashboard button:', {
        error: error.message,
        userId: interaction.user?.id,
        guildId: interaction.guildId,
      });

      const reply = {
        content: 'I could not fetch that dashboard detail right now. Please try again later.',
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
    } else if (interaction.commandName === 'icrew-help') {
      await replyInteractionWithAgentHelp(interaction);
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
    const isValidationError = status === 422;
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
        : isValidationError
        ? `Cerebro could not complete that action: ${error.message}${error.apiError ? `\n${error.apiError}` : ''}`
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
