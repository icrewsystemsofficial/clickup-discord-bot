const { EmbedBuilder } = require('discord.js');

const COLORS = {
  primary: 0x5865f2,
  success: 0x57f287,
  meeting: 0x2ecc71,
};

const MAX_MESSAGE = 1900;
const MAX_FIELD = 1024;
const TIMEZONE = 'Asia/Kolkata';

function truncate(text, max = MAX_MESSAGE) {
  const value = String(text || '').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 80)}\n…truncated. Ask a narrower question for more details.`;
}

function extractMentionIds(values) {
  const ids = new Set();
  const list = Array.isArray(values) ? values : [values];

  list.forEach((value) => {
    if (!value) return;
    if (typeof value === 'string' && /^\d{15,25}$/.test(value)) {
      ids.add(value);
      return;
    }
    [...String(value).matchAll(/<@!?(\d{15,25})>/g)].forEach((match) => ids.add(match[1]));
  });

  return [...ids].slice(0, 100);
}

function formatDateTime(value) {
  if (!value) return 'Not set';
  const date = typeof value === 'number'
    ? new Date(value > 9999999999 ? value : value * 1000)
    : new Date(value);

  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString('en-IN', {
    timeZone: TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatBulletLines(lines, { emptyText = 'No records found.' } = {}) {
  if (!lines?.length) return emptyText;
  return lines.map((line) => (line.startsWith('•') || line.startsWith('-') ? line : `• ${line}`)).join('\n');
}

function baseEmbed(color = COLORS.primary) {
  return new EmbedBuilder().setColor(color).setTimestamp();
}

function buildHelpEmbed() {
  return baseEmbed(COLORS.primary)
    .setTitle('Icrew Agent Help')
    .setDescription('Ask me natural-language questions about attendance, ClickUp tasks, SOPs, staff status, and meetings.')
    .addFields(
      {
        name: 'Attendance',
        value: [
          '`@ClickUp Bot who clocked in today?`',
          '`@ClickUp Bot @Santhosh clockin details`',
          '`@ClickUp Bot who clocked in today but did not do any tasks?`',
        ].join('\n'),
      },
      {
        name: 'ClickUp',
        value: [
          '`@ClickUp Bot @Santhosh status`',
          '`@ClickUp Bot @Santhosh overdue tasks`',
          '`@ClickUp Bot how many overdue tasks are there for software team?`',
        ].join('\n'),
      },
      {
        name: 'SOPs',
        value: [
          '`@ClickUp Bot password sop url`',
          '`@ClickUp Bot show all sop list`',
        ].join('\n'),
      },
      {
        name: 'Meetings',
        value: [
          '`@ClickUp Bot create a meeting with @Santhosh and @Ajay about testing update at 2 pm today`',
          'If you skip the time, I will ask when to schedule it. Duration defaults to 30 minutes.',
        ].join('\n'),
      },
      {
        name: 'Other Actions',
        value: '`@ClickUp Bot issue an LoA to @Santhosh today`',
      }
    );
}

function buildDashboardEmbed({ target, clockStatus, clockCount, pendingCount, overdueCount }) {
  return baseEmbed(COLORS.primary)
    .setTitle(`Status — ${target.displayName || target.username}`)
    .setDescription(`<@${target.id}>`)
    .addFields(
      {
        name: 'Attendance',
        value: `${clockStatus}\n${clockCount} clock-in record${clockCount === 1 ? '' : 's'} today`,
        inline: true,
      },
      {
        name: 'ClickUp',
        value: `${pendingCount} pending\n${overdueCount} overdue`,
        inline: true,
      }
    );
}

function buildMeetingSuccessEmbed({ draft, result, note, formatDisplayDate, formatDisplayTime }) {
  const attendeeText = draft.attendees
    .map((attendee) => (attendee.discordId ? `<@${attendee.discordId}>` : attendee.email))
    .join(', ');

  const embed = baseEmbed(COLORS.meeting)
    .setTitle('Meeting Scheduled')
    .setDescription(`**${draft.title}**`)
    .addFields(
      {
        name: 'When',
        value: `${formatDisplayDate(draft.date)} · ${formatDisplayTime(draft.startTime)} · ${draft.durationMinutes} min`,
        inline: false,
      },
      {
        name: 'Attendees',
        value: truncate(attendeeText || 'Not available', MAX_FIELD),
        inline: false,
      }
    );

  if (result.meet_link) {
    embed.addFields({ name: 'Google Meet', value: result.meet_link });
  }

  if (result.calendar_link) {
    embed.addFields({ name: 'Calendar', value: result.calendar_link });
  }

  if (note) {
    embed.setFooter({ text: 'Only two attendees are supported per meeting.' });
  }

  return embed;
}

function formatWelcomeMessage() {
  return [
    'Hi! I can help with **attendance**, **ClickUp tasks**, **SOPs**, and **Google Meet scheduling**.',
    'Mention me with your question, or type `@ClickUp Bot help` for examples.',
  ].join('\n');
}

function formatFallbackHelpMessage() {
  return [
    'I did not quite understand that.',
    'Try asking about attendance, ClickUp tasks, staff lookup, SOP details, or scheduling a meeting.',
    'Example: `@ClickUp Bot @Santhosh overdue tasks`',
  ].join('\n');
}

function formatAttendanceMessage({ title, subtitle, lines, date }) {
  return truncate([
    `**${title}**`,
    subtitle,
    date ? `Date: ${date}` : null,
    '',
    formatBulletLines(lines, { emptyText: 'No attendance records found.' }),
  ].filter(Boolean).join('\n'));
}

function formatWhoClockedInMessage({ total, lines }) {
  return truncate([
    `**Clocked in today:** ${total}`,
    '',
    formatBulletLines(lines, { emptyText: 'No one has clocked in today.' }),
  ].join('\n'));
}

function formatNoTasksAnalyticsMessage({ lines }) {
  return truncate([
    '**Clocked in with no ClickUp tasks today**',
    '',
    formatBulletLines(lines, { emptyText: 'No matching users found.' }),
    '',
    '_Note: uses ClickUp tasks due today as the activity proxy._',
  ].join('\n'));
}

function formatOverdueTeamMessage({ total, teamLabel, lines }) {
  return truncate([
    `**Overdue ClickUp tasks${teamLabel ? ` — ${teamLabel}` : ''}:** ${total}`,
    '',
    formatBulletLines(lines, { emptyText: 'No overdue tasks found for that team filter.' }),
  ].join('\n'));
}

function formatClickUpTasksMessage({ filter, scope, discordId, tasks, date }) {
  const filterLabel = filter || 'pending';
  const heading =
    scope === 'all'
      ? `**ClickUp ${filterLabel} tasks — all staff**`
      : `**ClickUp ${filterLabel} tasks for** <@${discordId}>`;

  const lines = tasks.map((task, index) => {
    const name = task.name || task.title || `Task ${index + 1}`;
    const status = task.status?.status || task.status || task.state || 'unknown';
    const due = task.due_date || task.dueDate || task.due;
    const url = task.url || task.link || task.task_url;
    const ownerId = task.ownerDiscordId || '';
    const owner = ownerId ? ` · <@${ownerId}>` : '';
    const dueText = due ? ` · due ${formatDateTime(due)}` : '';
    const link = url ? `\n  ${url}` : '';
    return `**${name}**${owner} (${status}${dueText})${link}`;
  });

  return truncate([
    heading,
    date ? `Date: ${date}` : null,
    tasks.length ? `Count: ${tasks.length}` : null,
    '',
    formatBulletLines(lines, { emptyText: 'No ClickUp tasks found.' }),
  ].filter(Boolean).join('\n'));
}

function formatStaffMessage({ users }) {
  const lines = users.map((user) => {
    const mention = user.discordId ? `<@${user.discordId}>` : user.name;
    return `${mention} — ${user.name}`;
  });

  return truncate([
    `**Staff users** (${users.length})`,
    '',
    formatBulletLines(lines, { emptyText: 'No staff users found.' }),
  ].join('\n'));
}

function formatSopMessage({ items, filter }) {
  const lines = items.map((item) => {
    const title = item.title || item.name || item.label || item.key || 'SOP';
    const url = item.url || item.link;
    return url ? `**${title}**\n${url}` : `**${title}**`;
  });

  return truncate([
    '**SOP details**',
    filter ? `Filter: ${filter}` : null,
    '',
    formatBulletLines(lines, { emptyText: 'No SOP details found.' }),
  ].filter(Boolean).join('\n'));
}

function formatClockDetailsMessage({ discordId, payload }) {
  const records = Array.isArray(payload?.clock_ins)
    ? payload.clock_ins
    : Array.isArray(payload?.records)
    ? payload.records
    : Array.isArray(payload?.data)
    ? payload.data
    : [];
  const isClockedIn = Boolean(payload?.is_clocked_in);
  const status = isClockedIn ? 'Currently clocked in' : 'Not clocked in now';

  const lines = records.slice(0, 8).map((record, index) => {
    const inTime = record.in_time || record.clock_in || record.clockIn;
    const outTime = record.out_time || record.clock_out || record.clockOut;
    const duration = record.duration || record.total_hours || record.work_hours;
    const isOpen = Boolean(record.is_open) || !outTime;
    const durationText = record.display_duration || (isOpen || !duration || /^n\/?a$/i.test(String(duration))
      ? 'In progress'
      : duration);
    const inTimeText = record.in_time_ist || formatDateTime(inTime);
    const outTimeText = record.out_time_ist || formatDateTime(outTime);

    return [
      `**Session ${index + 1}**`,
      `Clocked in: ${inTimeText} IST`,
      `Clocked out: ${isOpen ? 'Not yet' : `${outTimeText} IST`}`,
      `Duration: ${durationText}`,
    ]
      .filter(Boolean)
      .join('\n  ');
  });

  return truncate([
    `**Clock-in details for** <@${discordId}>`,
    `**Status:** ${status}`,
    payload?.date ? `**Date:** ${payload.date}` : null,
    records.length ? `**Sessions:** ${records.length}` : null,
    '',
    lines.length
      ? formatBulletLines(lines)
      : 'No clock-in records found for today.',
  ].join('\n'));
}

function formatTaskListMessage({ filter, discordId, tasks }) {
  const lines = tasks.slice(0, 8).map((task, index) => {
    const name = task.name || task.title || `Task ${index + 1}`;
    const status = task.status?.status || task.status || 'unknown';
    const due = task.due || task.due_date || task.dueDate;
    const url = task.url || task.link || task.task_url;
    return [
      `**${name}** (${status}, due: ${formatDateTime(due)})`,
      url || null,
    ].filter(Boolean).join('\n');
  });

  return truncate([
    `**ClickUp ${filter} tasks for** <@${discordId}>`,
    '',
    lines.length
      ? formatBulletLines(lines)
      : `No ClickUp ${filter} tasks found.`,
  ].join('\n'));
}

function formatMeetingPromptMessage(prompt) {
  return truncate(`**${prompt.title}**\n${prompt.description}`);
}

function formatLoaSuccessMessage({ targetId, loa, messageText }) {
  const dateRange =
    loa.end_date && loa.end_date !== loa.start_date
      ? `${loa.start_date} to ${loa.end_date}`
      : loa.start_date;

  return [
    `LoA ${messageText || 'created'} for <@${targetId}>.`,
    `Date: ${dateRange || 'Not set'}`,
    `Status: ${loa.status || 'Unknown'}`,
    `LoA ID: ${loa.id || 'N/A'}`,
  ].join('\n');
}

function toReplyPayload({ embeds = [], content, userIds = [], components, ephemeral = false }) {
  const payload = {
    allowedMentions: {
      parse: [],
      users: extractMentionIds(userIds),
    },
  };

  if (content) payload.content = truncate(content, MAX_MESSAGE);
  if (embeds.length) payload.embeds = embeds.slice(0, 10);
  if (components?.length) payload.components = components;
  if (ephemeral) payload.ephemeral = true;

  return payload;
}

module.exports = {
  buildDashboardEmbed,
  buildHelpEmbed,
  buildMeetingSuccessEmbed,
  extractMentionIds,
  formatAttendanceMessage,
  formatClockDetailsMessage,
  formatClickUpTasksMessage,
  formatFallbackHelpMessage,
  formatLoaSuccessMessage,
  formatMeetingPromptMessage,
  formatNoTasksAnalyticsMessage,
  formatOverdueTeamMessage,
  formatSopMessage,
  formatStaffMessage,
  formatTaskListMessage,
  formatWelcomeMessage,
  formatWhoClockedInMessage,
  formatDateTime,
  toReplyPayload,
  truncate,
};
