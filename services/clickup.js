const axios = require('axios');

// Validate API token
if (!process.env.CLICKUP_API_TOKEN) {
  throw new Error('CLICKUP_API_TOKEN environment variable is required');
}

// Create axios instance with timeout and error handling
const api = axios.create({
  baseURL: 'https://api.clickup.com/api/v2',
  timeout: 10000, // 10 second timeout
  headers: {
    Authorization: process.env.CLICKUP_API_TOKEN,
    'Content-Type': 'application/json',
  },
});

// Request interceptor for logging (optional, can be removed in production)
api.interceptors.request.use(
  (config) => {
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      // API responded with error status
      const status = error.response.status;
      const message = error.response.data?.err || error.response.data?.message || error.message;
      
      const customError = new Error(message);
      customError.status = status;
      customError.response = error.response;
      return Promise.reject(customError);
    } else if (error.request) {
      // Request made but no response received
      const customError = new Error('No response received from ClickUp API');
      customError.code = 'ENOTFOUND';
      customError.request = error.request;
      return Promise.reject(customError);
    } else {
      // Error setting up request
      return Promise.reject(error);
    }
  }
);

/**
 * Fetches a task from ClickUp by task ID
 * @param {string} taskId - The ClickUp task ID
 * @returns {Promise<Object>} The task data
 * @throws {Error} If the request fails or task is not found
 */
async function getTask(taskId) {
  if (!taskId || typeof taskId !== 'string') {
    throw new Error('Task ID must be a non-empty string');
  }

  try {
    const { data } = await api.get(`/task/${encodeURIComponent(taskId.trim())}`);
    
    if (!data) {
      throw new Error('No data received from ClickUp API');
    }
    
    return data;
  } catch (error) {
    if (error.status === 404) {
      const notFoundError = new Error('Task not found');
      notFoundError.status = 404;
      throw notFoundError;
    }
    throw error;
  }
}

/**
 * Fetches comments for a task from ClickUp by task ID
 * @param {string} taskId - The ClickUp task ID
 * @returns {Promise<Array>} Array of comments
 * @throws {Error} If the request fails
 */
async function getComments(taskId) {
  if (!taskId || typeof taskId !== 'string') {
    throw new Error('Task ID must be a non-empty string');
  }

  try {
    const { data } = await api.get(`/task/${encodeURIComponent(taskId.trim())}/comment`);
    
    if (!data || !Array.isArray(data.comments)) {
      return [];
    }
    
    return data.comments;
  } catch (error) {
    if (error.status === 404) {
      // Task not found, return empty array for comments
      return [];
    }
    throw error;
  }
}

module.exports = { getTask, getComments };
