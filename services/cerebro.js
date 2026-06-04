const axios = require('axios');
const https = require('https');

const CEREBRO_BASE_URL =
  process.env.CEREBRO_BASE_URL || 'https://cerebro.test';
const CEREBRO_TLS_REJECT_UNAUTHORIZED =
  process.env.CEREBRO_TLS_REJECT_UNAUTHORIZED !== 'false';
const httpsAgent = CEREBRO_TLS_REJECT_UNAUTHORIZED
  ? undefined
  : new https.Agent({ rejectUnauthorized: false });

function requireCerebroToken() {
  if (!process.env.CEREBRO_AI_AGENT_TOKEN) {
    throw new Error('CEREBRO_AI_AGENT_TOKEN environment variable is required');
  }
}

const api = axios.create({
  baseURL: CEREBRO_BASE_URL.replace(/\/$/, ''),
  timeout: 15000,
  httpsAgent,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  requireCerebroToken();
  config.headers['X-AI-Agent-Token'] = process.env.CEREBRO_AI_AGENT_TOKEN;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const message =
      error.response?.data?.message ||
      error.response?.data?.err ||
      error.message ||
      'Cerebro API request failed';

    const customError = new Error(message);
    customError.status = status;
    customError.response = error.response;
    throw customError;
  }
);

function clean(value) {
  if (value === undefined || value === null || value === '') return undefined;
  return value;
}

async function getStaffUsers() {
  const { data } = await api.get('/api/v1/ai-agent/staff-users');
  return data;
}

async function getUserByDiscordId(discordId) {
  const { data } = await api.get(
    `/api/v1/ai-agent/discord-users/${encodeURIComponent(discordId)}`
  );
  return data;
}

async function getClockInDetails({ discordId, date } = {}) {
  const params = { date: clean(date) };
  const path = discordId
    ? `/api/v1/ai-agent/discord-users/${encodeURIComponent(discordId)}/clock-in-details`
    : '/api/v1/ai-agent/clock-in-details';

  const { data } = await api.get(path, { params });
  return data;
}

async function getClickUpTasks({ discordId, filter = 'pending', date, listId } = {}) {
  const params = {
    filter: clean(filter) || 'pending',
    date: clean(date),
    list_id: clean(listId || process.env.CEREBRO_CLICKUP_LIST_ID),
  };
  const path = discordId
    ? `/api/v1/ai-agent/discord-users/${encodeURIComponent(discordId)}/clickup-tasks`
    : '/api/v1/ai-agent/clickup-tasks';

  const { data } = await api.get(path, { params });
  return data;
}

async function getSopDetails({ filter } = {}) {
  const { data } = await api.get('/api/v1/ai-agent/sop-details', {
    params: { filter: clean(filter) },
  });
  return data;
}

async function createLoaForDiscordUser(discordId, payload = {}) {
  const { data } = await api.post(
    `/api/v1/ai-agent/discord-users/${encodeURIComponent(discordId)}/loa`,
    payload
  );
  return data;
}

async function scheduleMeeting(payload = {}) {
  const { data } = await api.post('/api/v1/ai-agent/meetings', payload);
  return data;
}

module.exports = {
  getStaffUsers,
  getUserByDiscordId,
  getClockInDetails,
  getClickUpTasks,
  getSopDetails,
  createLoaForDiscordUser,
  scheduleMeeting,
};
