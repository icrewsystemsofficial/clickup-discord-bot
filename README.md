# clickup-discord-bot
A simple discord bot that makes it less annoying for us to preview ClickUp links on discord.

## Mention-based AI Agent

The bot also answers natural-language staff operations questions when it is tagged in Discord.

Example messages:

```text
@bot i need all users clockin details and @santhosh task details
@bot show my pending clickup tasks
@bot attendance details for @santhosh today
@bot all staff overdue tasks
@bot show all sop list
@bot @santhosh status
@bot my dashboard
@bot help
@bot who clocked in today but did not do any tasks?
@bot how many overdue tasks are there for software team?
@bot issue an LoA to @santhosh today
@bot schedule a 30 minutes meeting with @akshay about overdue tasks today
```

The mention agent uses the Cerebro AI Agent API endpoints from `Cerebro AI Agent API.postman_collection.json`:

- Staff users: `/api/v1/ai-agent/staff-users`
- User lookup by Discord ID: `/api/v1/ai-agent/discord-users/{discord_id}`
- Clock-in details: `/api/v1/ai-agent/clock-in-details`
- User clock-in details: `/api/v1/ai-agent/discord-users/{discord_id}/clock-in-details`
- ClickUp tasks: `/api/v1/ai-agent/clickup-tasks`
- User ClickUp tasks: `/api/v1/ai-agent/discord-users/{discord_id}/clickup-tasks`
- SOP details: `/api/v1/ai-agent/sop-details`

Answers include Discord mentions like `<@discord_id>` when the Cerebro API returns a Discord ID.

When the user asks for all SOPs or an SOP list, the bot shows a Discord dropdown. Selecting an SOP replies with the Cabinet URL.

When the user asks for a status, dashboard, overview, or summary, the bot replies with an attendance and ClickUp dashboard card plus quick action buttons for pending tasks, overdue tasks, and clock-in details.

Run `/icrew-help` in Discord to see the agent examples and current capabilities.

Analytics currently supported:

- Clocked in today but no ClickUp tasks due today.
- Overdue ClickUp task count by team-like keyword such as software, operations, HR, or PR.

Write actions supported:

- Create an approved one-day LoA for a mentioned Discord user.
- Schedule a Google Calendar meeting with a mentioned Discord user, with overdue ClickUp task gist lines added to the meeting description when requested.

## Environment Variables

```bash
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
CLICKUP_API_TOKEN=

CEREBRO_AI_AGENT_TOKEN=
CEREBRO_BASE_URL=https://cerebro.test
CEREBRO_TLS_REJECT_UNAUTHORIZED=false
CEREBRO_CLICKUP_LIST_ID=

OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1/chat/completions
OPENROUTER_MODEL=openrouter/free
OPENROUTER_SITE_URL=
OPENROUTER_APP_NAME=ClickUp Discord Bot
```

`OPENROUTER_API_KEY` is optional. When it is present, the bot uses OpenRouter free models to plan the best Cerebro API calls from natural language. When it is missing, the bot uses a fallback parser for common attendance and ClickUp task questions.

`OPENROUTER_MODEL` is forced to free-only usage. Use `openrouter/free` for the free router, or a specific free model ending with `:free`. If a paid model ID is configured, the bot logs a warning and falls back to `openrouter/free`.

`OPENROUTER_SITE_URL` is optional. Use your public project URL, GitHub repo URL, or app website URL when you have one. For local/dev bots, you can leave it empty and the bot will use its built-in repo URL fallback.

`CEREBRO_TLS_REJECT_UNAUTHORIZED=false` is for local development with `https://cerebro.test` when Node cannot verify the local certificate. Do not use this setting for production.

The custom AI prompt lives in `prompts/cerebro-ai-agent.md`.

## Discord Setup

Enable the privileged `Message Content Intent` for the bot in the Discord Developer Portal. The mention-based agent needs it to read messages like `@bot all users clockin details`.
