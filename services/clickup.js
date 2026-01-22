const axios = require('axios');

const api = axios.create({
  baseURL: 'https://api.clickup.com/api/v2',
  headers: {
    Authorization: process.env.CLICKUP_API_TOKEN
  }
});

async function getTask(taskId) {
  const { data } = await api.get(`/task/${taskId}`);
  return data;
}

async function getComments(taskId) {
  const { data } = await api.get(`/task/${taskId}/comment`);
  return data.comments || [];
}

module.exports = { getTask, getComments };
