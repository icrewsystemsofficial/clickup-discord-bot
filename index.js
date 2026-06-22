const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });

const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
} = require('discord.js');

const { getTask, getComments } = require('./services/clickup');
const { answerNaturalLanguageQuestion } = require('./services/aiAgent');
const {
  createLoaForDiscordUser,
  getClockInDetails,
  getClickUpTasks,
  getSopDetails,
} = require('./services/cerebro');
const {
  formatDisplayDate,
  formatDisplayTime,
  processMeetingMessage,
  wantsMeetingAction,
} = require('./services/meeting');
const {
  buildDashboardEmbed,
  buildHelpEmbed,
  buildMeetingSuccessEmbed,
  formatLoaSuccessMessage,
  formatMeetingPromptMessage,
  formatNoTasksAnalyticsMessage,
  formatOverdueTeamMessage,
  formatSopMessage,
  formatClockDetailsMessage,
  formatTaskListMessage,
  formatWelcomeMessage,
  formatWhoClockedInMessage,
  toReplyPayload,
} = require('./services/discordFormat');

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

function directlyMentionsBot(content, botUserId) {
  return new RegExp(`<@!?${botUserId}>`).test(String(content || ''));
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

function normalizeSopRecord(item) {
  const id = item?.id ?? item?.key ?? item?.cabinet_page_id;

  return {
    ...item,
    id: id == null ? '' : String(id),
    title: item?.title || item?.name || item?.label || 'Untitled SOP',
    description: item?.description || '',
    url: item?.link || item?.url || '',
    priority:
      item?.priority !== null &&
      item?.priority !== undefined &&
      Number.isFinite(Number(item.priority))
        ? Number(item.priority)
        : null,
  };
}

function normalizeSopPayload(payload) {
  return asArray(payload)
    .map(normalizeSopRecord)
    .filter((sop) => sop.id && sop.title)
    .sort((a, b) => {
      if (a.priority !== null && b.priority !== null && a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      if (a.priority !== null) return -1;
      if (b.priority !== null) return 1;
      return a.title.localeCompare(b.title);
    });
}

function wantsSopDropdown(question) {
  return /\b(sops?|procedures?|polic(?:y|ies)|standard operating procedures?)\b/i.test(question) &&
    /\b(all|list|dropdown|select)\b/i.test(question);
}

function wantsSopDetails(question) {
  return /\b(sops?|procedures?|polic(?:y|ies)|standard operating procedures?)\b/i.test(question) && !wantsSopDropdown(question);
}

function extractSopSearch(question) {
  return String(question || '')
    .replace(/\b(?:i\s+need|need|give|find|get|fetch|open|show|tell\s+me|about|details?|link|url|the|a|an)\b/gi, ' ')
    .replace(/\b(?:sops?|procedures?|polic(?:y|ies)|standard operating procedures?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wantsUserDashboard(question) {
  return /\b(status|dashboard|overview|summary)\b/i.test(question) &&
    !/\b(sops?|procedures?|polic(?:y|ies)|standard operating procedures?)\b/i.test(question);
}

function wantsAgentHelp(question) {
  return /\b(help|what can you do|capabilities|commands|agent help|how to use)\b/i.test(question);
}

function wantsClockedInNoTasksAnalytics(question) {
  return /\b(clocked in|clockin|clock-in|attendance)\b/i.test(question) &&
    /\b(no tasks|without tasks|didn'?t.*tasks|not.*tasks|no work|didn'?t really do)\b/i.test(question);
}

function wantsWhoClockedIn(question) {
  return /\b(who|who all|how|how many|how much|all users|all staff|everyone|every one|team|staff|users)\b/i.test(question) &&
    /\b(clocked in|clocked-in|clockin|clock-in|attendance)\b/i.test(question) &&
    !/\b(my|me|mine)\b/i.test(question) &&
    !/\b(no tasks|without tasks|didn'?t.*tasks|not.*tasks|no work|didn'?t really do)\b/i.test(question);
}

function wantsOverdueTeamAnalytics(question) {
  return /\boverdue\b/i.test(question) &&
    /\b(task|tasks|clickup)\b/i.test(question) &&
    /\b(team|department|software|operations|hr|human resources|pr|public relations)\b/i.test(question);
}

function wantsWriteAction(question) {
  return /\b(issue|mark|create|apply|add)\b.*\b(loa|leave|awol)\b/i.test(question) ||
    wantsMeetingAction(question);
}

function wantsLoaAction(question) {
  return /\b(issue|mark|create|apply|add)\b.*\b(loa|leave|awol)\b/i.test(question);
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
  await message.reply(toReplyPayload({
    embeds: [buildHelpEmbed()],
  }));
}

async function replyInteractionWithAgentHelp(interaction) {
  await interaction.reply({
    ...toReplyPayload({ embeds: [buildHelpEmbed()] }),
    ephemeral: true,
  });
}

async function replyInteractionWithDebug(interaction) {
  const required = [
    ['View Channel', PermissionsBitField.Flags.ViewChannel],
    ['Send Messages', PermissionsBitField.Flags.SendMessages],
    ['Read Message History', PermissionsBitField.Flags.ReadMessageHistory],
    ['Embed Links', PermissionsBitField.Flags.EmbedLinks],
    ['Use Application Commands', PermissionsBitField.Flags.UseApplicationCommands],
  ];
  const botMember = interaction.guild?.members.me ||
    (interaction.guild ? await interaction.guild.members.fetchMe() : null);
  const permissions = botMember && interaction.channel
    ? interaction.channel.permissionsFor(botMember)
    : null;
  const lines = required.map(([label, flag]) =>
    `${permissions?.has(flag) ? 'OK' : 'MISSING'} ${label}`
  );

  await interaction.reply({
    content: [
      `Bot: ${interaction.client.user.tag} (${interaction.client.user.id})`,
      `Guild: ${interaction.guild?.name || 'unknown'} (${interaction.guildId || 'unknown'})`,
      `Channel: ${interaction.channel?.name || interaction.channelId} (${interaction.channelId})`,
      '',
      lines.join('\n'),
      '',
      'If View Channel or Send Messages is missing, add the bot role/member to this private channel permissions.',
      'If all permissions are OK but mentions do not work, enable Message Content Intent in the Discord Developer Portal and restart the bot.',
    ].join('\n'),
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
    const mention = user.discord_id ? `<@${user.discord_id}>` : user.name || 'Unknown user';
    const count = group.clock_ins_count || asArray(group.clock_ins).length;
    return `${mention} — ${count} clock-in record(s), 0 ClickUp today tasks`;
  });

  await message.reply(toReplyPayload({
    content: formatNoTasksAnalyticsMessage({ lines }),
    userIds: getUniqueDiscordIds(lines),
  }));
}

async function replyWhoClockedIn(message) {
  const attendanceData = await getClockInDetails();
  const clockedInUsers = asArray(attendanceData).filter((group) =>
    group?.is_clocked_in || Number(group?.clock_ins_count || 0) > 0 || asArray(group?.clock_ins).length > 0
  );
  const lines = clockedInUsers.slice(0, 30).map((group) => {
    const user = group.user || {};
    const count = group.clock_ins_count || asArray(group.clock_ins).length;
    const state = group.is_clocked_in ? 'Currently clocked in' : `${count} clock-in record(s) today`;
    const mention = user.discord_id ? `<@${user.discord_id}>` : user.name || 'Unknown user';
    return `${mention} — ${state}`;
  });

  await message.reply(toReplyPayload({
    content: formatWhoClockedInMessage({ total: clockedInUsers.length, lines }),
    userIds: getUniqueDiscordIds(lines),
  }));
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
      const mention = user.discord_id ? `<@${user.discord_id}>` : user.name || 'Unknown user';
      return `${mention} — ${group.count} overdue`;
    });

  await message.reply(toReplyPayload({
    content: formatOverdueTeamMessage({
      total,
      teamLabel: /\bsoftware\b/i.test(question) ? 'Software team' : '',
      lines,
    }),
    userIds: getUniqueDiscordIds(lines),
  }));
}

async function replyWriteActionGuidance(message, question) {
  const lines = ['I understand this as an action request.'];
  if (/\b(loa|leave|awol)\b/i.test(question)) {
    lines.push('LoA creation requires valid approver and leave-type settings in Cerebro.');
  }
  lines.push('I can still help gather context first, such as overdue tasks or user status.');

  await message.reply(toReplyPayload({
    content: lines.join('\n\n'),
  }));
}

async function handleLoaAction(message, question) {
  const target = getMentionedUsers(message)[0];

  if (!target) {
    await message.reply(toReplyPayload({
      content: 'Please mention the user for the LoA, for example `@ClickUp Bot issue an LoA to @Santhosh today`.',
    }));
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

  await message.reply(toReplyPayload({
    content: formatLoaSuccessMessage({
      targetId: target.id,
      loa,
      messageText: response.message?.toLowerCase() || 'created',
    }),
    userIds: [target.id],
  }));
}

async function replyToMeetingResult(message, result) {
  if (result.type === 'none') return false;

  if (result.type === 'config_error' || result.type === 'error') {
    await message.reply(toReplyPayload({
      content: result.message,
    }));
    return true;
  }

  if (result.type === 'cancelled') {
    await message.reply(toReplyPayload({
      content: result.message,
    }));
    return true;
  }

  if (result.type === 'prompt') {
    await message.reply(toReplyPayload({
      content: formatMeetingPromptMessage(result.prompt),
      userIds: result.draft.attendees.map((attendee) => attendee.discordId).filter(Boolean),
    }));
    return true;
  }

  if (result.type === 'success') {
    await message.reply(toReplyPayload({
      content: result.note || undefined,
      embeds: [buildMeetingSuccessEmbed({
        draft: result.draft,
        result: result.result,
        note: result.note,
        formatDisplayDate,
        formatDisplayTime,
      })],
      userIds: result.draft.attendees.map((attendee) => attendee.discordId).filter(Boolean),
    }));
    return true;
  }

  return false;
}

async function handleMeetingMessage(message, question, { isExplicitMeetingRequest = false } = {}) {
  const result = await processMeetingMessage({
    channelId: message.channel.id,
    authorId: message.author.id,
    question,
    mentionedUsers: getMentionedUsers(message),
    isExplicitMeetingRequest,
  });

  return replyToMeetingResult(message, result);
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

  const embed = buildDashboardEmbed({
    target,
    clockStatus,
    clockCount,
    pendingCount,
    overdueCount,
  });

  await message.reply({
    ...toReplyPayload({
      embeds: [embed],
      userIds: [target.id],
    }),
    components: buildDashboardButtons(target.id),
  });
}

async function handleDashboardButton(interaction) {
  const [, action, discordId] = interaction.customId.split(':');

  if (!discordId) {
    await interaction.reply({
      ...toReplyPayload({
        content: 'Missing dashboard user ID.',
      }),
      ephemeral: true,
    });
    return;
  }

  if (action === 'clock') {
    const data = await getClockInDetails({ discordId });
    await interaction.reply({
      ...toReplyPayload({
        content: formatClockDetailsMessage({ discordId, payload: data }),
        userIds: [discordId],
      }),
      ephemeral: true,
    });
    return;
  }

  const filter = action === 'overdue' ? 'overdue' : 'pending';
  const data = await getClickUpTasks({ discordId, filter });
  const tasks = getTaskItems(data);

  await interaction.reply({
    ...toReplyPayload({
      content: formatTaskListMessage({ filter, discordId, tasks }),
      userIds: [discordId],
    }),
    ephemeral: true,
  });
}

function buildSopSelectMenu(sops) {
  const options = sops.slice(0, 125).map((sop) => ({
      label: String(sop.title).slice(0, 100),
      description: String(sop.description || (sop.url ? 'Cabinet link available' : 'No Cabinet link configured')).slice(0, 100),
      value: String(sop.id).slice(0, 100),
    }));

  if (!options.length) return [];

  const rows = [];
  for (let index = 0; index < options.length; index += 25) {
    const page = Math.floor(index / 25) + 1;
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`sop_select:${page}`)
        .setPlaceholder(options.length > 25 ? `Select an SOP (page ${page})` : 'Select an SOP')
        .addOptions(options.slice(index, index + 25))
    ));
  }

  return rows;
}

async function replyWithSopDropdown(message) {
  const data = await getSopDetails();
  const sops = normalizeSopPayload(data);
  const components = buildSopSelectMenu(sops);

  if (!components.length) {
    await message.reply(toReplyPayload({
      content: 'No SOP details found.',
    }));
    return true;
  }

  await message.reply({
    ...toReplyPayload({
      content: 'Select an SOP from the dropdown to get the Cabinet link.',
    }),
    components,
  });
  return true;
}

function sopMatchesSearch(sop, search) {
  const needle = String(search || '').toLowerCase();
  const haystack = [
    sop.title,
    sop.description,
    sop.type,
    sop.url,
    ...(Array.isArray(sop.tags)
      ? sop.tags.flatMap((tag) => [tag?.name, tag?.value])
      : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(needle);
}

async function replyWithSopDetails(message, question) {
  const search = extractSopSearch(question);

  if (!search) {
    await message.reply(toReplyPayload({
      content: 'Please mention the SOP name, or ask for `all SOP list`.',
    }));
    return;
  }

  const data = await getSopDetails({ filter: search });
  let sops = normalizeSopPayload(data);

  if (!sops.length) {
    const allData = await getSopDetails();
    sops = normalizeSopPayload(allData).filter((sop) => sopMatchesSearch(sop, search));
  }

  await message.reply(toReplyPayload({
    content: formatSopMessage({ items: sops.slice(0, 10), filter: search }),
  }));
}

async function handleSopSelect(interaction) {
  const selectedId = interaction.values?.[0];
  const data = await getSopDetails();
  const sop = normalizeSopPayload(data).find((item) => item.id === selectedId);

  if (!sop) {
    await interaction.reply({
      ...toReplyPayload({
        content: 'I could not find that SOP anymore. Please ask for the SOP list again.',
      }),
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    ...toReplyPayload({
      content: sop.url
        ? `**${sop.title}**\n${sop.url}`
        : `**${sop.title}**\nNo Cabinet link is configured for this SOP.`,
    }),
    ephemeral: true,
  });
}

async function handleBotMention(message) {
  if (!directlyMentionsBot(message.content, client.user.id)) return;

  const question = stripBotMention(message.content, client.user.id);

  if (!question) {
    await message.reply(toReplyPayload({
      content: formatWelcomeMessage(),
    }));
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

  if (wantsSopDetails(question)) {
    await replyWithSopDetails(message, question);
    return;
  }

  if (wantsClockedInNoTasksAnalytics(question)) {
    await replyClockedInNoTasksAnalytics(message);
    return;
  }

  if (wantsWhoClockedIn(question)) {
    await replyWhoClockedIn(message);
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
    await handleMeetingMessage(message, question, { isExplicitMeetingRequest: true });
    return;
  }

  if (await handleMeetingMessage(message, question)) {
    return;
  }

  if (wantsWriteAction(question)) {
    await replyWriteActionGuidance(message, question);
    return;
  }

  const requesterMember = message.guild?.members.cache.get(message.author.id);
  const { content, userIds } = await answerNaturalLanguageQuestion({
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
    ...userIds,
  ]);

  await message.reply(toReplyPayload({
    content,
    userIds: allowedUserIds,
  }));
}

// Validate task ID format (ClickUp task IDs are alphanumeric, e.g. "8xdfdjbgd")
function isValidTaskId(taskId) {
  if (!taskId || typeof taskId !== 'string') return false;
  const trimmed = taskId.trim();
  if (trimmed.length < 2) return false;
  return /^[a-zA-Z0-9_-]+$/.test(trimmed);
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function escapeDiscordLinkLabel(value) {
  return String(value || '').replace(/([\\\[\]])/g, '\\$1');
}

function linkifyPlainUrls(value) {
  return String(value || '').replace(
    /(?<![<(])(https?:\/\/[^\s<>\])]+)/gi,
    (url) => `<${url}>`
  );
}

function getClickUpCommentPartUrl(part) {
  const attributeLink = part?.attributes?.link;
  const candidates = [
    part?.link_mention?.url,
    part?.bookmark?.url,
    part?.bookmark?.id,
    part?.attachment?.url,
    part?.file?.url,
    part?.image?.url,
    part?.video?.url,
    typeof attributeLink === 'string' ? attributeLink : attributeLink?.url,
    part?.attributes?.url,
  ];

  return candidates.find(isHttpUrl) || '';
}

function formatClickUpComment(comment) {
  if (Array.isArray(comment?.comment) && comment.comment.length) {
    return comment.comment
      .map((part) => {
        const text = String(part?.text || '');
        const link = getClickUpCommentPartUrl(part);

        if (isHttpUrl(link)) {
          return text.trim()
            ? `[${escapeDiscordLinkLabel(text)}](${link})`
            : `<${link}>`;
        }

        return linkifyPlainUrls(text);
      })
      .join('')
      .trim();
  }

  return linkifyPlainUrls(comment?.comment_text).trim();
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

  const [task, comments] = await Promise.all([
    getTask(taskId.trim()),
    getComments(taskId.trim()),
  ]);

  if (!comments || !comments.length) {
    return interaction.editReply({
      content: 'No comments found for this task.',
    });
  }
  
  const comment = comments[0];
  
  const commentText = formatClickUpComment(comment);

  if (!comment || !commentText) {
    return interaction.editReply({
      content: 'No valid comments found for this task.',
    });
  }

  const description = commentText.length > 4000
    ? `${commentText.slice(0, 3980)}\n…comment truncated`
    : commentText;
  const author = {
    name: comment.user?.username || comment.user?.email || 'Unknown User',
  };
  if (isHttpUrl(comment.user?.profilePicture)) {
    author.iconURL = comment.user.profilePicture;
  }

  const embed = new EmbedBuilder()
    .setTitle(task?.name || `ClickUp Task ${taskId.trim()}`)
    .setAuthor(author)
    .setDescription(description)
    .setFooter({ text: `Latest comment · Task ${taskId.trim()}` });

  if (isHttpUrl(task?.url)) {
    embed.setURL(task.url);
  }

  const commentDate = Number(comment.date);
  if (Number.isFinite(commentDate)) {
    embed.setTimestamp(new Date(commentDate > 9999999999 ? commentDate : commentDate * 1000));
  }
  
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
  console.log(`Cerebro API: ${process.env.CEREBRO_BASE_URL || 'https://cerebro.test'}`);
  if (
    process.env.CEREBRO_BASE_URL &&
    !process.env.CEREBRO_BASE_URL.includes('cerebro.test') &&
    process.env.CEREBRO_TLS_REJECT_UNAUTHORIZED === 'false'
  ) {
    console.warn('CEREBRO_TLS_REJECT_UNAUTHORIZED=false is only recommended for local cerebro.test.');
  }
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
        ...toReplyPayload({
          content: 'I could not fetch that dashboard detail right now. Please try again later.',
        }),
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
      if (interaction.customId.startsWith('sop_select')) {
        await handleSopSelect(interaction);
      }
    } catch (error) {
      console.error('Error handling SOP select menu:', {
        error: error.message,
        userId: interaction.user?.id,
        guildId: interaction.guildId,
      });

      const reply = {
        ...toReplyPayload({
          content: 'I could not fetch that SOP link right now. Please try again later.',
        }),
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
    } else if (interaction.commandName === 'icrew-debug') {
      await replyInteractionWithDebug(interaction);
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

    const isMeetingError = error.message?.includes('GOOGLE_MEET_WEBHOOK_URL') ||
      error.message?.includes('Meeting could not be created');

    await message.reply(toReplyPayload({
      content: isConfigError
        ? 'CEREBRO_AI_AGENT_TOKEN is missing. Please add it to the bot environment.'
        : error.message?.includes('GOOGLE_MEET_WEBHOOK_URL')
        ? 'Meeting scheduling is not configured yet. Please add `GOOGLE_MEET_WEBHOOK_URL` to the bot environment.'
        : isAuthError
        ? 'I could not access the Cerebro AI Agent API. Please check the API token and permissions.'
        : isValidationError
        ? `I could not complete that action: ${error.message}${error.apiError ? `\n${error.apiError}` : ''}`
        : isMeetingError
        ? `I couldn't schedule that meeting: ${error.message}`
        : 'I could not fetch those details right now. Please try again later.',
    }));
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
  if (error.message?.includes('Used disallowed intents')) {
    console.error(
      'Discord rejected one of the bot gateway intents. Enable Message Content Intent in the Discord Developer Portal for this bot application, then restart the bot.'
    );
  }
  console.error('Failed to login to Discord:', error);
  process.exit(1);
});
