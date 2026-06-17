const axios = require('axios');
const { getUserByDiscordId } = require('./cerebro');

const TIMEZONE = 'Asia/Kolkata';
const DEFAULT_DURATION_MINUTES = 30;
const PENDING_TTL_MS = 15 * 60 * 1000;
const MAX_ATTENDEES = 2;

const pendingMeetings = new Map();

function getPendingKey(channelId, authorId) {
  return `${channelId}:${authorId}`;
}

function clearExpiredPending() {
  const now = Date.now();
  for (const [key, value] of pendingMeetings.entries()) {
    if (now - value.createdAt > PENDING_TTL_MS) {
      pendingMeetings.delete(key);
    }
  }
}

function getPendingMeeting(channelId, authorId) {
  clearExpiredPending();
  return pendingMeetings.get(getPendingKey(channelId, authorId)) || null;
}

function savePendingMeeting(channelId, authorId, draft) {
  clearExpiredPending();
  pendingMeetings.set(getPendingKey(channelId, authorId), {
    ...draft,
    createdAt: Date.now(),
  });
}

function clearPendingMeeting(channelId, authorId) {
  pendingMeetings.delete(getPendingKey(channelId, authorId));
}

function normalizeQuestion(question) {
  return String(question || '')
    .replace(/\s+/g, ' ')
    .replace(/[“”]/g, '"')
    .trim();
}

function getTodayInKolkata() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function getTomorrowInKolkata() {
  const today = getTodayInKolkata();
  const [year, month, day] = today.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getNowInKolkataParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

function extractDate(question) {
  const text = normalizeQuestion(question);

  const isoDate = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoDate) return isoDate[1];

  const slashDate = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (slashDate) {
    const [, day, month, year] = slashDate;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  if (/\btomorrow\b/i.test(text)) return getTomorrowInKolkata();
  if (/\btoday\b/i.test(text)) return getTodayInKolkata();
  return '';
}

function parseHourMinute(hour, minute, meridiem) {
  let parsedHour = Number(hour);
  const parsedMinute = Number(minute || 0);

  if (Number.isNaN(parsedHour) || Number.isNaN(parsedMinute)) return '';
  if (parsedMinute > 59 || parsedHour > 23) return '';

  if (meridiem) {
    const lower = meridiem.toLowerCase();
    if (lower === 'pm' && parsedHour < 12) parsedHour += 12;
    if (lower === 'am' && parsedHour === 12) parsedHour = 0;
  }

  if (parsedHour > 23) return '';

  return `${String(parsedHour).padStart(2, '0')}:${String(parsedMinute).padStart(2, '0')}`;
}

function extractStartTime(question) {
  const text = normalizeQuestion(question);

  if (/\bnoon\b/i.test(text)) return '12:00';
  if (/\bmidnight\b/i.test(text)) return '00:00';

  let match = text.match(/\b(?:at|around|by|@)?\s*([01]?\d|2[0-3]):([0-5]\d)\s*(am|pm)?\b/i);
  if (match) {
    const time = parseHourMinute(match[1], match[2], match[3]);
    if (time) return time;
  }

  match = text.match(/\b(?:at|around|by)?\s*([01]?\d|2[0-3])\s*(am|pm)\b/i);
  if (match) {
    const time = parseHourMinute(match[1], '00', match[2]);
    if (time) return time;
  }

  match = text.match(/\b(?:at|around|by)?\s*([01]?\d|2[0-3])(am|pm)\b/i);
  if (match) {
    const time = parseHourMinute(match[1], '00', match[2]);
    if (time) return time;
  }

  return '';
}

function hasExplicitDuration(question) {
  return (
    /\b(\d{1,3})\s*(minutes?|mins?|m)\b/i.test(question) ||
    /\b(\d{1,2})\s*(hours?|hrs?|hr)\b/i.test(question) ||
    /\bhalf\s+(?:an?\s+)?hour\b/i.test(question)
  );
}

function extractDurationMinutes(question) {
  const text = normalizeQuestion(question);

  if (/\bhalf\s+(?:an?\s+)?hour\b/i.test(text)) return 30;

  const hourMatch = text.match(/\b(\d{1,2})\s*(hours?|hrs?|hr)\b/i);
  if (hourMatch) {
    const hours = Number(hourMatch[1]);
    if (hours >= 1 && hours <= 8) return hours * 60;
  }

  const minuteMatch = text.match(/\b(\d{1,3})\s*(minutes?|mins?|m)\b/i);
  if (minuteMatch) {
    const minutes = Number(minuteMatch[1]);
    if (minutes >= 5 && minutes <= 480) return minutes;
  }

  return DEFAULT_DURATION_MINUTES;
}

function extractEmails(question) {
  return [...new Set(
    [...normalizeQuestion(question).matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)]
      .map((match) => match[0].toLowerCase())
  )];
}

function stripSchedulingNoise(value) {
  return String(value || '')
    .replace(/<@!?\d+>/g, '')
    .replace(/\b(?:today|tomorrow|\d{4}-\d{2}-\d{2})\b/gi, '')
    .replace(/\b(?:at|around|by)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, '')
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, '')
    .replace(/\b\d{1,3}\s*(?:minutes?|mins?|hours?|hrs?|hr)\b/gi, '')
    .replace(/\b(?:schedule|create|book|set up|organize|organise|plan)\b/gi, '')
    .replace(/\b(?:a|an|the)\s+(?:google\s+)?(?:meet(?:ing)?|calendar(?:\s+event)?|call|video call)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPlainTitle(question) {
  const cleaned = stripSchedulingNoise(normalizeQuestion(question));
  if (cleaned.length < 3) return '';
  if (extractEmails(cleaned).length) return '';
  if (extractStartTime(cleaned)) return '';
  if (extractDate(cleaned)) return '';
  if (wantsMeetingAction(cleaned)) return '';
  if (cleaned.split(/\s+/).length > 12) return '';
  return cleaned;
}

function extractMeetingTitle(question, { allowPlainText = false } = {}) {
  const text = normalizeQuestion(question);

  const titleMatch = text.match(/\btitle\s*:\s*["']?(.+?)["']?\s*$/i);
  if (titleMatch) return stripSchedulingNoise(titleMatch[1]);

  const quoted = text.match(/["'](.+?)["']/);
  if (quoted) return stripSchedulingNoise(quoted[1]);

  const patterns = [
    /\b(?:with|between)\s+(?:<@!?\d+>\s*(?:,?\s*and\s*)?)+(?:for|about|on|regarding|to discuss)\s+(?:the\s+)?(.+)$/i,
    /\b(?:about|regarding|to discuss)\s+(?:the\s+)?(.+)$/i,
    /\bfor\s+(?:the\s+)?(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;

    const title = stripSchedulingNoise(match[1]);
    if (title.length >= 3 && !/^@?\w+(\s+and\s+@?\w+)?$/i.test(title)) {
      return title;
    }
  }

  if (allowPlainText) {
    return extractPlainTitle(question);
  }

  return '';
}

function wantsMeetingAction(question) {
  const text = normalizeQuestion(question).toLowerCase();

  if (/\b(schedule|create|book|set up|setup|organize|organise|plan|arrange|fix)\b.*\b(meeting|calendar|call|google meet|video call|sync|standup|stand-up)\b/.test(text)) {
    return true;
  }

  if (/\b(meeting|calendar event|google meet|video call|standup|stand-up)\b.*\b(with|for|between)\b/.test(text)) {
    return true;
  }

  if (/\b(meeting|call)\b/.test(text) && extractEmails(text).length >= 2) {
    return true;
  }

  return false;
}

function isCancelRequest(question) {
  return /\b(cancel|nevermind|never mind|stop|abort|forget it)\b/i.test(question);
}

function looksLikeMeetingFollowUp(question, pending) {
  if (!pending) return false;
  if (isCancelRequest(question)) return true;
  if (wantsMeetingAction(question)) return true;
  if (extractStartTime(question)) return true;
  if (extractDate(question)) return true;
  if (extractEmails(question).length) return true;
  if (extractMeetingTitle(question)) return true;
  if (hasExplicitDuration(question)) return true;
  if (/\btitle\s*:/i.test(question)) return true;

  const words = normalizeQuestion(question).split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 10;
}

function addMinutesToTime(time, minutes) {
  const [hour, minute] = time.split(':').map(Number);
  const total = hour * 60 + minute + minutes;
  const endHour = Math.floor(total / 60) % 24;
  const endMinute = total % 60;
  return `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`;
}

function compareDateTime(dateA, timeA, dateB, timeB) {
  const a = Number(dateA.replace(/-/g, '')) * 10000 + Number(timeA.replace(':', ''));
  const b = Number(dateB.replace(/-/g, '')) * 10000 + Number(timeB.replace(':', ''));
  return a - b;
}

function isDateTimeInPast(date, time) {
  const now = getNowInKolkataParts();
  return compareDateTime(date, time, now.date, now.time) <= 0;
}

function formatDisplayDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: TIMEZONE,
  });
}

function formatDisplayTime(time) {
  const [hour, minute] = time.split(':').map(Number);
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: TIMEZONE,
  });
}

function toIsoDateTime(date, time) {
  return `${date}T${time}:00`;
}

async function resolveAttendeeEmail(discordId) {
  const data = await getUserByDiscordId(discordId);
  const user = data?.data || data?.user || data;
  const email = user?.email || user?.work_email || user?.personal_email;
  return email ? String(email).toLowerCase() : '';
}

function attendeeKey(attendee) {
  return attendee.discordId || attendee.email || attendee.label;
}

function mergeAttendees(existing, incoming) {
  const merged = [...(existing || [])];

  for (const attendee of incoming || []) {
    const duplicate = merged.some(
      (item) =>
        (item.email && attendee.email && item.email === attendee.email) ||
        (item.discordId && attendee.discordId && item.discordId === attendee.discordId)
    );
    if (!duplicate) merged.push(attendee);
  }

  return merged;
}

async function resolveAttendees({ mentionedUsers, emails, requesterDiscordId, existingAttendees = [] }) {
  const resolved = [];
  const unresolved = [];

  for (const user of mentionedUsers) {
    try {
      const email = await resolveAttendeeEmail(user.id);
      if (email) {
        resolved.push({
          discordId: user.id,
          label: user.displayName || user.username,
          email,
        });
      } else {
        unresolved.push({
          discordId: user.id,
          label: user.displayName || user.username,
        });
      }
    } catch (error) {
      unresolved.push({
        discordId: user.id,
        label: user.displayName || user.username,
      });
    }
  }

  for (const email of emails) {
    if (!resolved.some((item) => item.email === email)) {
      resolved.push({
        discordId: '',
        label: email,
        email,
      });
    }
  }

  let merged = mergeAttendees(existingAttendees, resolved);

  if (merged.length === 1 && requesterDiscordId && merged[0].discordId !== requesterDiscordId) {
    try {
      const requesterEmail = await resolveAttendeeEmail(requesterDiscordId);
      if (requesterEmail && !merged.some((item) => item.email === requesterEmail)) {
        merged.unshift({
          discordId: requesterDiscordId,
          label: 'you',
          email: requesterEmail,
        });
      }
    } catch (error) {
      // Requester lookup failed; we'll ask for another attendee if needed.
    }
  }

  return {
    resolved: merged,
    unresolved: unresolved.filter(
      (item) => !merged.some((attendee) => attendee.discordId === item.discordId)
    ),
  };
}

function parseMeetingRequest(question, context = {}) {
  const parsedDate = extractDate(question);
  const parsedTime = extractStartTime(question);
  const parsedTitle = extractMeetingTitle(question, {
    allowPlainText: Boolean(context.allowPlainTitle),
  });
  const parsedEmails = extractEmails(question);

  return {
    date: parsedDate || context.date || '',
    startTime: parsedTime || context.startTime || '',
    durationMinutes: hasExplicitDuration(question)
      ? extractDurationMinutes(question)
      : context.durationMinutes || DEFAULT_DURATION_MINUTES,
    title: parsedTitle || context.title || '',
    emails: parsedEmails.length ? parsedEmails : context.emails || [],
    hasExplicitDate: Boolean(parsedDate || context.hasExplicitDate),
    hasExplicitTime: Boolean(parsedTime || context.hasExplicitTime),
    hasExplicitDuration: hasExplicitDuration(question) || Boolean(context.hasExplicitDuration),
  };
}

function buildDraftFromInput({ question, pending, mentionedUsers }) {
  const parsed = parseMeetingRequest(question, {
    ...(pending || {}),
    allowPlainTitle: Boolean(pending && !pending.title),
  });

  return {
    attendees: pending?.attendees || [],
    unresolvedAttendees: pending?.unresolvedAttendees || [],
    excessAttendees: [],
    title: parsed.title,
    date: parsed.date || getTodayInKolkata(),
    startTime: parsed.startTime,
    durationMinutes: parsed.durationMinutes,
    mentionedUsers: mentionedUsers || [],
    emails: parsed.emails,
    hasExplicitDate: parsed.hasExplicitDate,
    hasExplicitTime: parsed.hasExplicitTime,
    hasExplicitDuration: parsed.hasExplicitDuration,
  };
}

async function enrichDraft(draft, requesterDiscordId) {
  const { resolved, unresolved } = await resolveAttendees({
    mentionedUsers: draft.mentionedUsers,
    emails: draft.emails,
    requesterDiscordId,
    existingAttendees: draft.attendees,
  });

  const excessAttendees = resolved.length > MAX_ATTENDEES ? resolved.slice(MAX_ATTENDEES) : [];

  return {
    ...draft,
    attendees: resolved.slice(0, MAX_ATTENDEES),
    unresolvedAttendees: unresolved,
    excessAttendees,
  };
}

function buildMissingFields(draft) {
  const missing = [];

  if (!draft.attendees?.length) {
    missing.push('attendees');
  } else if (draft.attendees.length < MAX_ATTENDEES) {
    missing.push('second_attendee');
  }

  if (draft.unresolvedAttendees?.length) {
    missing.push('attendee_email');
  }

  if (!draft.title?.trim()) {
    missing.push('title');
  }

  if (!draft.startTime) {
    missing.push('start_time');
  }

  if (draft.startTime && isDateTimeInPast(draft.date, draft.startTime)) {
    missing.push('past_time');
  }

  return missing;
}

function buildMeetingPrompt(missingFields, draft) {
  const attendeeLines = (draft.attendees || [])
    .map((attendee) => (attendee.discordId ? `<@${attendee.discordId}>` : attendee.email))
    .join(', ');

  if (missingFields.includes('attendees') || missingFields.includes('second_attendee')) {
    return {
      title: 'Who should join this meeting?',
      description: [
        'Please mention **two people** or provide **two email addresses**.',
        '',
        'Examples:',
        '`@ClickUp Bot schedule a meeting with @Santhosh and @Ajay about testing update at 2 pm today`',
        '`@ClickUp Bot book a call for one@example.com and two@example.com title: Sprint review at 3 pm`',
      ].join('\n'),
    };
  }

  if (missingFields.includes('attendee_email')) {
    const names = draft.unresolvedAttendees
      .map((attendee) => `<@${attendee.discordId}>`)
      .join(', ');
    return {
      title: 'I need email addresses',
      description: [
        `I couldn't find calendar emails for ${names}.`,
        'Please reply with their work emails, or ask them to link their account in Cerebro.',
      ].join('\n'),
    };
  }

  if (missingFields.includes('title')) {
    return {
      title: 'What is this meeting about?',
      description: [
        attendeeLines ? `**Attendees:** ${attendeeLines}` : null,
        'Share a short title or topic for the meeting.',
        '',
        'Examples:',
        '`testing update`',
        '`title: Sprint planning`',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }

  if (missingFields.includes('past_time')) {
    return {
      title: 'That time has already passed',
      description: [
        `**${draft.title}**`,
        attendeeLines ? `**With:** ${attendeeLines}` : null,
        `The time you gave (${formatDisplayTime(draft.startTime)} on ${formatDisplayDate(draft.date)}) is in the past.`,
        '',
        'Please reply with a future time, for example:',
        '`tomorrow at 10 am`',
        '`3:30 pm today`',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }

  if (missingFields.includes('start_time')) {
    return {
      title: 'When should I schedule it?',
      description: [
        `**${draft.title}**`,
        attendeeLines ? `**With:** ${attendeeLines}` : null,
        `**Duration:** ${draft.durationMinutes} minutes${draft.hasExplicitDuration ? '' : ' (default)'}`,
        '',
        'Reply with a date and time, for example:',
        '`2 pm today`',
        '`tomorrow at 10:30 am`',
        '`2026-06-20 at 3 pm`',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }

  return {
    title: 'I need a little more information',
    description: 'Please share the missing meeting details and I will continue from there.',
  };
}

async function createGoogleMeetEvent({
  email1,
  email2,
  title,
  description,
  date,
  startTime,
  durationMinutes,
}) {
  const webhookUrl = process.env.GOOGLE_MEET_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error('GOOGLE_MEET_WEBHOOK_URL is not configured');
  }

  const endTime = addMinutesToTime(startTime, durationMinutes);
  const payload = [
    {
      email_1: email1,
      email_2: email2,
      title: title.slice(0, 255),
      description: description || '',
      timezone: TIMEZONE,
      startDateTime: toIsoDateTime(date, startTime),
      endDateTime: toIsoDateTime(date, endTime),
    },
  ];

  const { data } = await axios.post(webhookUrl, payload, {
    timeout: 30000,
    headers: { 'Content-Type': 'application/json' },
  });

  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.success) {
    const missing = result?.missing_fields?.length
      ? ` Missing: ${result.missing_fields.join(', ')}`
      : '';
    throw new Error(`${result?.message || 'Meeting could not be created.'}${missing}`);
  }

  return {
    ...result,
    durationMinutes,
    endTime,
  };
}

async function processMeetingMessage({
  channelId,
  authorId,
  question,
  mentionedUsers,
  isExplicitMeetingRequest = false,
}) {
  if (!process.env.GOOGLE_MEET_WEBHOOK_URL) {
    return {
      type: 'config_error',
      message: 'Meeting scheduling is not configured yet. Please add `GOOGLE_MEET_WEBHOOK_URL` to the bot environment.',
    };
  }

  const pending = isExplicitMeetingRequest ? null : getPendingMeeting(channelId, authorId);
  const normalizedQuestion = normalizeQuestion(question);

  if (pending && isCancelRequest(normalizedQuestion)) {
    clearPendingMeeting(channelId, authorId);
    return {
      type: 'cancelled',
      message: 'Got it — I cancelled the pending meeting request.',
    };
  }

  const shouldProcess =
    isExplicitMeetingRequest ||
    (pending && looksLikeMeetingFollowUp(normalizedQuestion, pending));

  if (!shouldProcess) {
    return { type: 'none' };
  }

  let draft = buildDraftFromInput({
    question: normalizedQuestion,
    pending,
    mentionedUsers,
  });
  draft = await enrichDraft(draft, authorId);

  const missingFields = buildMissingFields(draft);
  if (missingFields.length) {
    const prompt = buildMeetingPrompt(missingFields, draft);
    savePendingMeeting(channelId, authorId, {
      attendees: draft.attendees,
      unresolvedAttendees: draft.unresolvedAttendees,
      title: draft.title,
      date: draft.date,
      startTime: draft.startTime,
      durationMinutes: draft.durationMinutes,
      emails: draft.emails,
      hasExplicitDate: draft.hasExplicitDate,
      hasExplicitTime: draft.hasExplicitTime,
      hasExplicitDuration: draft.hasExplicitDuration,
    });

    return {
      type: 'prompt',
      draft,
      prompt,
    };
  }

  try {
    const [firstAttendee, secondAttendee] = draft.attendees;
    const result = await createGoogleMeetEvent({
      email1: firstAttendee.email,
      email2: secondAttendee.email,
      title: draft.title,
      description: `Scheduled via Icrew Discord bot.`,
      date: draft.date,
      startTime: draft.startTime,
      durationMinutes: draft.durationMinutes,
    });

    clearPendingMeeting(channelId, authorId);

    return {
      type: 'success',
      draft,
      result,
      note: draft.excessAttendees.length
        ? `Only two attendees are supported right now. These people were not added: ${draft.excessAttendees
            .map((attendee) => (attendee.discordId ? `<@${attendee.discordId}>` : attendee.email))
            .join(', ')}`
        : '',
    };
  } catch (error) {
    return {
      type: 'error',
      message: error.message || 'Meeting could not be created.',
    };
  }
}

module.exports = {
  DEFAULT_DURATION_MINUTES,
  TIMEZONE,
  MAX_ATTENDEES,
  addMinutesToTime,
  buildDraftFromInput,
  buildMeetingPrompt,
  buildMissingFields,
  clearPendingMeeting,
  createGoogleMeetEvent,
  enrichDraft,
  extractDate,
  extractDurationMinutes,
  extractEmails,
  extractMeetingTitle,
  extractStartTime,
  formatDisplayDate,
  formatDisplayTime,
  getPendingMeeting,
  isDateTimeInPast,
  looksLikeMeetingFollowUp,
  parseMeetingRequest,
  processMeetingMessage,
  resolveAttendees,
  savePendingMeeting,
  wantsMeetingAction,
};
