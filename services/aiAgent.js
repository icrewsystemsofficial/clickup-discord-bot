const fs = require('fs');
const path = require('path');
const axios = require('axios');
const {
  getStaffUsers,
  getClockInDetails,
  getClickUpTasks,
  getSopDetails,
} = require('./cerebro');
const {
  formatAttendanceMessage,
  formatClickUpTasksMessage,
  formatFallbackHelpMessage,
  formatSopMessage,
  formatStaffMessage,
  extractMentionIds,
} = require('./discordFormat');

const promptPath = path.join(__dirname, '..', 'prompts', 'cerebro-ai-agent.md');
const systemPrompt = fs.readFileSync(promptPath, 'utf8');

const DEFAULT_MODEL = 'openrouter/free';
const OPENROUTER_CHAT_COMPLETIONS_URL =
  process.env.OPENROUTER_BASE_URL ||
  'https://openrouter.ai/api/v1/chat/completions';

function getOpenRouterModel() {
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  if (model === 'openrouter/free' || model.endsWith(':free')) {
    return model;
  }

  console.warn(
    `OPENROUTER_MODEL "${model}" is not a free OpenRouter model. Using ${DEFAULT_MODEL}.`
  );
  return DEFAULT_MODEL;
}

function normalizeDiscordId(value) {
  if (!value) return '';
  const match = String(value).match(/\d{15,25}/);
  return match ? match[0] : '';
}

function getTodayInKolkata() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

function extractDate(question) {
  const isoDate = question.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (isoDate) return isoDate[0];

  const slashDate = question.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (slashDate) {
    const [, day, month, year] = slashDate;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  if (/\btoday\b/i.test(question)) return getTodayInKolkata();
  return '';
}

function inferTaskFilter(question) {
  const text = question.toLowerCase();
  if (/\boverdue\b/.test(text)) return 'overdue';
  if (/\bdelayed\b/.test(text)) return 'delayed';
  if (/\bupcoming\b/.test(text)) return 'upcoming';
  if (/\btoday\b/.test(text)) return 'today';
  if (/\b(completed|complete|done|closed|finished)\b/.test(text)) return 'completed';
  if (/\b(pending|open|active|todo|assigned|unfinished)\b/.test(text)) return 'pending';
  if (/\b(all tasks|task details|tasks details|tasks detail)\b/.test(text)) return 'all';
  return 'pending';
}

function inferSopFilter(question) {
  const text = question.toLowerCase();
  if (/\bpassword|passwords|credential|credentials|login\b/.test(text)) return 'password';
  if (/\bdocument|reference|number\b/.test(text)) return 'document';
  if (/\bcertificate|certificates\b/.test(text)) return 'certificate';
  if (/\btravel\b/.test(text)) return 'travel';
  return '';
}

function buildFallbackPlan({ question, requester, mentionedUsers }) {
  const lower = question.toLowerCase();
  const date = extractDate(question);
  const mentioned = mentionedUsers.filter((user) => user.id !== requester.id);
  const wantsRequester =
    /\b(my|me|mine|myself|for me)\b/.test(lower);
  const wantsAll =
    /\b(all users|all staff|everyone|every one|team|who|who all|how many|how much|users|staff)\b/.test(lower);
  const wantsClockIn =
    /\b(attendance|attendcae|clock ?in|clocked ?in|clocin|clock-in|clocked-in|clock out|clock-out|punched ?in|punch ?in|punch ?out|login|work hours)\b/.test(lower);
  const wantsTasks =
    /\b(clickup|task|tasks)\b/.test(lower);
  const actions = [];

  if (wantsClockIn) {
    if (wantsAll || (!mentioned.length && !wantsRequester)) {
      actions.push({
        type: 'clock_in_details',
        scope: 'all',
        discord_id: '',
        label: 'all staff',
        filter: '',
        date,
      });
    } else {
      const target = mentioned[0] || requester;
      actions.push({
        type: 'clock_in_details',
        scope: target.id === requester.id ? 'requester' : 'mentioned',
        discord_id: target.id,
        label: target.displayName || target.username || target.id,
        filter: '',
        date,
      });
    }
  }

  if (wantsTasks) {
    const targets = mentioned.length ? mentioned : wantsAll ? [] : [requester];
    const filter = inferTaskFilter(question);

    if (!targets.length && wantsAll) {
      actions.push({
        type: 'clickup_tasks',
        scope: 'all',
        discord_id: '',
        label: 'all staff',
        filter,
        date,
      });
    } else {
      targets.forEach((target) => {
        actions.push({
          type: 'clickup_tasks',
          scope: target.id === requester.id ? 'requester' : 'mentioned',
          discord_id: target.id,
          label: target.displayName || target.username || target.id,
          filter,
          date,
        });
      });
    }
  }

  if (!actions.length && /\b(sop|procedure|policy)\b/.test(lower)) {
    actions.push({
      type: 'sop_details',
      scope: 'all',
      discord_id: '',
      label: 'SOP',
      filter: inferSopFilter(question),
      date: '',
    });
  }

  return { actions };
}

function shouldUseDeterministicPlan(context) {
  const lower = context.question.toLowerCase();
  return (
    /\b(attendance|attendcae|clock ?in|clocked ?in|clocin|clock-in|clocked-in|clock out|clock-out|punched ?in|punch ?in|punch ?out|login|work hours|clickup|task|tasks|sop|procedure|policy)\b/.test(lower) ||
    context.mentionedUsers.length > 0
  );
}

function extractOutputText(data) {
  if (data.output_text) return data.output_text;

  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) chunks.push(content.text);
      if (content.type === 'text' && content.text) chunks.push(content.text);
    }
  }
  return chunks.join('\n').trim();
}

function parseJsonObject(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');

    if (start === -1 || end === -1 || end <= start) throw error;

    const jsonLike = cleaned
      .slice(start, end + 1)
      .replace(/,\s*([}\]])/g, '$1');

    return JSON.parse(jsonLike);
  }
}

async function planWithOpenRouter(context) {
  if (shouldUseDeterministicPlan(context)) {
    return buildFallbackPlan(context);
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return buildFallbackPlan(context);
  }

  try {
    const { data } = await axios.post(
      OPENROUTER_CHAT_COMPLETIONS_URL,
      {
        model: getOpenRouterModel(),
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: JSON.stringify({
              current_date: getTodayInKolkata(),
              requester: context.requester,
              mentioned_users: context.mentionedUsers,
              question: context.question,
            }),
          },
        ],
        temperature: 0,
        max_tokens: 600,
        response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'cerebro_discord_action_plan',
              strict: true,
              schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                actions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      type: {
                        type: 'string',
                        enum: [
                          'clock_in_details',
                          'clickup_tasks',
                          'staff_users',
                          'sop_details',
                        ],
                      },
                      scope: {
                        type: 'string',
                        enum: ['all', 'requester', 'mentioned'],
                      },
                      discord_id: { type: 'string' },
                      label: { type: 'string' },
                      filter: { type: 'string' },
                      date: { type: 'string' },
                    },
                    required: [
                      'type',
                      'scope',
                      'discord_id',
                      'label',
                      'filter',
                      'date',
                    ],
                  },
                },
              },
              required: ['actions'],
            },
          },
        },
      },
      {
        timeout: 15000,
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer':
            process.env.OPENROUTER_SITE_URL ||
            'https://github.com/santhosh/clickup-discord-bot',
          'X-OpenRouter-Title':
            process.env.OPENROUTER_APP_NAME || 'ClickUp Discord Bot',
        },
      }
    );

    const outputText = data.choices?.[0]?.message?.content || extractOutputText(data);
    const plan = parseJsonObject(outputText);
    return plan.actions?.length ? plan : buildFallbackPlan(context);
  } catch (error) {
    console.warn('OpenRouter planning failed, using fallback parser:', error.message);
    return buildFallbackPlan(context);
  }
}

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.users)) return payload.users;
  if (Array.isArray(payload?.staff_users)) return payload.staff_users;
  if (Array.isArray(payload?.clock_in_details)) return payload.clock_in_details;
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload?.tasks)) return payload.tasks;
  return payload ? [payload] : [];
}

function pickUserName(item) {
  return (
    item.name ||
    item.full_name ||
    item.username ||
    item.user?.name ||
    item.user?.username ||
    item.staff_user?.name ||
    'Unknown user'
  );
}

function pickDiscordId(item, fallbackId) {
  return normalizeDiscordId(
    item.discord_id ||
      item.discordId ||
      item.discord_user_id ||
      item.user?.discord_id ||
      item.staff_user?.discord_id ||
      fallbackId
  );
}

function formatDateTime(value) {
  if (!value) return '';
  if (typeof value === 'number') {
    const date = new Date(value > 9999999999 ? value : value * 1000);
    return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  }
  return String(value);
}

function formatClockLine(item, fallbackDiscordId) {
  const discordId = pickDiscordId(item, fallbackDiscordId);
  const mention = discordId ? `<@${discordId}>` : pickUserName(item);
  const clockIn =
    item.clock_in ||
    item.clockIn ||
    item.clock_in_time ||
    item.clockInTime ||
    item.first_clock_in ||
    item.login_time ||
    item.in_time;
  const clockOut =
    item.clock_out ||
    item.clockOut ||
    item.clock_out_time ||
    item.clockOutTime ||
    item.last_clock_out ||
    item.logout_time ||
    item.out_time;
  const total =
    item.total_hours ||
    item.work_hours ||
    item.working_hours ||
    item.duration ||
    item.total_time ||
    item.hours;
  const status = item.status || item.attendance_status || item.state;
  const parts = [];

  if (clockIn) parts.push(`in: ${formatDateTime(clockIn)}`);
  if (clockOut) parts.push(`out: ${formatDateTime(clockOut)}`);
  if (total) parts.push(`hours: ${total}`);
  if (status) parts.push(`status: ${status}`);

  return `- ${mention}: ${parts.length ? parts.join(', ') : 'no clock-in record found'}`;
}

function formatClockRecord(record) {
  const parts = [];

  if (record.in_time || record.clock_in || record.clockIn) {
    parts.push(`in: ${formatDateTime(record.in_time || record.clock_in || record.clockIn)}`);
  }

  if (record.out_time || record.clock_out || record.clockOut) {
    parts.push(`out: ${formatDateTime(record.out_time || record.clock_out || record.clockOut)}`);
  }

  if (record.duration || record.total_hours || record.work_hours) {
    parts.push(`duration: ${record.duration || record.total_hours || record.work_hours}`);
  }

  if (record.status) parts.push(`status: ${record.status}`);

  return parts.join(', ') || 'clock-in record found';
}

function formatClockGroup(group, fallbackDiscordId) {
  const user = group.user || group.staff_user || group;
  const discordId = pickDiscordId(user, fallbackDiscordId);
  const mention = discordId ? `<@${discordId}>` : pickUserName(user);
  const records = asArray(group.clock_ins || group.records || group.clock_in_details?.records);
  const currentClockIn = group.current_clock_in || group.clock_in_details?.current_clock_in;
  const status = group.is_clocked_in || group.clock_in_details?.is_clocked_in
    ? 'currently clocked in'
    : 'not clocked in now';

  if (!records.length && !currentClockIn) {
    return `- ${mention}: no clock-in record found, ${status}`;
  }

  const latest = records[records.length - 1] || currentClockIn;
  const count = records.length ? `${records.length} record${records.length === 1 ? '' : 's'}` : 'current session';
  return `- ${mention}: ${count}, ${status}; latest ${formatClockRecord(latest)}`;
}

function formatClockPayload(payload, fallbackDiscordId) {
  if (Array.isArray(payload?.data)) {
    return payload.data.map((group) => formatClockGroup(group, fallbackDiscordId));
  }

  if (Array.isArray(payload?.clock_ins) || payload?.current_clock_in) {
    return [formatClockGroup(payload, fallbackDiscordId)];
  }

  return asArray(payload).map((item) => formatClockLine(item, fallbackDiscordId));
}

function getTasksFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.tasks)) return payload.tasks;
  if (Array.isArray(payload?.data)) {
    const hasGroupedTasks = payload.data.some(
      (item) => item && (Array.isArray(item.data) || Array.isArray(item.tasks))
    );

    if (hasGroupedTasks) {
      return payload.data.flatMap((group) =>
        asArray(group.data || group.tasks).map((task) => ({
          ...task,
          staff_user: group.user || group.staff_user,
        }))
      );
    }

    return payload.data;
  }
  if (Array.isArray(payload?.clickup_tasks)) return payload.clickup_tasks;
  if (Array.isArray(payload?.users)) {
    return payload.users.flatMap((user) =>
      asArray(user.tasks || user.clickup_tasks).map((task) => ({
        ...task,
        staff_user: user,
      }))
    );
  }
  return payload ? [payload] : [];
}

function filterSopItems(items, filter) {
  if (!filter) return items;
  const needle = filter.toLowerCase();

  return items.filter((item) => {
    const text = [
      item.key,
      item.title,
      item.name,
      item.label,
      item.url,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return text.includes(needle);
  });
}

function formatTaskForEmbed(task, index) {
  const ownerId = pickDiscordId(task.staff_user || task.user || {}, '');
  return {
    name: task.name || task.title || `Task ${index + 1}`,
    title: task.name || task.title || `Task ${index + 1}`,
    status: task.status?.status || task.status || task.state || 'unknown',
    due_date: task.due_date || task.dueDate || task.due,
    dueDate: task.due_date || task.dueDate || task.due,
    due: task.due_date || task.dueDate || task.due,
    url: task.url || task.link || task.task_url,
    link: task.url || task.link || task.task_url,
    task_url: task.url || task.link || task.task_url,
    ownerDiscordId: ownerId,
  };
}

async function executeAction(action) {
  const discordId = normalizeDiscordId(action.discord_id);

  if (action.type === 'clock_in_details') {
    const data = await getClockInDetails({
      discordId: action.scope === 'all' ? '' : discordId,
      date: action.date,
    });
    const lines = formatClockPayload(data, discordId);
    const title =
      action.scope === 'all'
        ? 'Attendance Details'
        : 'Attendance Details';
    const subtitle =
      action.scope === 'all'
        ? 'All staff'
        : `<@${discordId}>`;

    const content = formatAttendanceMessage({
      title,
      subtitle,
      lines: lines.slice(0, 20),
      date: action.date || undefined,
    });

    return {
      content,
      userIds: action.scope === 'all' ? extractMentionIds(lines) : [discordId],
    };
  }

  if (action.type === 'clickup_tasks') {
    const data = await getClickUpTasks({
      discordId: action.scope === 'all' ? '' : discordId,
      filter: action.filter || 'pending',
      date: action.date,
    });
    const tasks = getTasksFromPayload(data).slice(0, 10).map(formatTaskForEmbed);
    const content = formatClickUpTasksMessage({
      filter: action.filter || 'pending',
      scope: action.scope,
      discordId,
      tasks,
      date: action.date || undefined,
    });

    return {
      content,
      userIds: action.scope === 'all'
        ? tasks.map((task) => task.ownerDiscordId).filter(Boolean)
        : [discordId],
    };
  }

  if (action.type === 'staff_users') {
    const users = asArray(await getStaffUsers())
      .slice(0, 20)
      .map((user) => ({
        discordId: pickDiscordId(user, ''),
        name: pickUserName(user),
      }));

    return {
      content: formatStaffMessage({ users }),
      userIds: users.map((user) => user.discordId).filter(Boolean),
    };
  }

  if (action.type === 'sop_details') {
    const data = await getSopDetails({ filter: action.filter });
    const items = filterSopItems(asArray(data), action.filter).slice(0, 10);

    return {
      content: formatSopMessage({ items, filter: action.filter || undefined }),
      userIds: [],
    };
  }

  return { content: '', userIds: [] };
}

async function answerNaturalLanguageQuestion(context) {
  const plan = await planWithOpenRouter(context);

  if (!plan.actions?.length) {
    return {
      content: formatFallbackHelpMessage(),
      userIds: [],
    };
  }

  const parts = [];
  const userIds = new Set();

  for (const action of plan.actions.slice(0, 4)) {
    const result = await executeAction(action);
    if (result.content) parts.push(result.content);
    result.userIds.forEach((id) => userIds.add(id));
  }

  if (!parts.length) {
    return {
      content: formatFallbackHelpMessage(),
      userIds: [],
    };
  }

  return {
    content: parts.join('\n\n'),
    userIds: [...userIds],
  };
}

module.exports = {
  answerNaturalLanguageQuestion,
  normalizeDiscordId,
  shouldUseDeterministicPlan,
};
