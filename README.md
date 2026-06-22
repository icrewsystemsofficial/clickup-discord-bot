# ClickUp Discord Bot (Icrew)

A Discord bot for iCrew that previews ClickUp tasks, answers staff operations questions in natural language, and handles actions like LoA creation and Google Meet scheduling.

Tag the bot in Discord or use slash commands to interact with Cerebro data.

## Features

### Slash commands

| Command | Description |
|---------|-------------|
| `/clickup-task` | Fetch a ClickUp task by ID |
| `/clickup-comment` | Fetch the latest comment on a ClickUp task |
| `/icrew-help` | Show agent capabilities and example prompts |

### Mention-based AI agent

Mention the bot with a natural-language question. Examples:

```text
@Icrew my task details
@Icrew my clickup tasks
@Icrew @Santhosh task details
@Icrew clickup tasks in progress
@Icrew status is task assigned
@Icrew who clocked in today?
@Icrew @Santhosh clockin details
@Icrew who clocked in today but did not do any tasks?
@Icrew @Santhosh status
@Icrew @Santhosh overdue tasks
@Icrew how many overdue tasks are there for software team?
@Icrew show all sop list
@Icrew password sop url
@Icrew help
@Icrew issue an LoA to @Santhosh today
@Icrew create a meeting with @Santhosh and @Ajay about testing update at 2 pm today
```

If you skip the meeting time, the bot asks when to schedule it. Duration defaults to 30 minutes.

### ClickUp tasks

The bot uses the Cerebro AI Agent API, which reads tasks from your ClickUp workspace. ClickUp workspaces can have custom statuses (for example `Task Assigned`, `In Progress`, `Internal Review`).

| You ask | What you get |
|---------|--------------|
| `my task details`, `my clickup tasks` | All **assigned, non-completed** tasks for you |
| `@User task details` | That user's active assigned tasks |
| `clickup tasks in progress` | Your tasks filtered by that status name |
| `status is internal review` | Tasks matching that ClickUp status |
| `overdue tasks` | Overdue tasks only |
| `completed tasks` | Completed/closed tasks only |

Completed tasks are detected from ClickUp `status.type` (`closed` / `done`), not from hardcoded status names.

### Attendance and analytics

- Clock-in details for a user or all staff
- Who is clocked in today
- Clocked in today but no ClickUp tasks due today
- Overdue ClickUp task counts by team keyword (software, operations, HR, PR)

### SOPs

- Ask for a specific SOP by keyword (for example `password sop url`)
- Ask for `show all sop list` to get a Discord dropdown with Cabinet links

### Dashboard

Ask for `@User status`, `my dashboard`, or `overview` to get an embed with attendance and ClickUp counts, plus buttons for active tasks, overdue tasks, and clock-in details.

### Write actions

- **LoA** — Create an approved one-day LoA for a mentioned Discord user
- **Meetings** — Schedule Google Calendar / Meet events via an n8n webhook (see `meeting.md`)

## Cerebro API endpoints used

The agent calls these Cerebro AI Agent API routes:

- Staff users: `GET /api/v1/ai-agent/staff-users`
- User lookup: `GET /api/v1/ai-agent/discord-users/{discord_id}`
- Clock-in details: `GET /api/v1/ai-agent/clock-in-details`
- User clock-in: `GET /api/v1/ai-agent/discord-users/{discord_id}/clock-in-details`
- ClickUp tasks: `GET /api/v1/ai-agent/clickup-tasks`
- User ClickUp tasks: `GET /api/v1/ai-agent/discord-users/{discord_id}/clickup-tasks`
- SOP details: `GET /api/v1/ai-agent/sop-details`

ClickUp task queries support:

- `filter` — `active` (default), `overdue`, `delayed`, `today`, `upcoming`, `completed`, `all`
- `status` — optional exact ClickUp status name (for example `in progress`)

Answers include Discord mentions like `<@discord_id>` when Cerebro returns a mapped Discord ID.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

### 3. Register slash commands

```bash
npm run register
```

### 4. Run locally

```bash
npm run dev
```

For production, use `npm start` or PM2 (see `deployed.md`).

## Environment variables

```bash
# Discord
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=

# ClickUp (slash commands)
CLICKUP_API_TOKEN=

# Cerebro AI Agent
CEREBRO_AI_AGENT_TOKEN=
CEREBRO_BASE_URL=https://cerebro.icrewsystems.com
CEREBRO_TLS_REJECT_UNAUTHORIZED=true
CEREBRO_CLICKUP_LIST_ID=

# OpenRouter (optional — improves natural-language planning)
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1/chat/completions
OPENROUTER_MODEL=openrouter/free
OPENROUTER_SITE_URL=
OPENROUTER_APP_NAME=ClickUp Discord Bot

# Google Meet (optional — required for meeting scheduling)
GOOGLE_MEET_WEBHOOK_URL=
```

| Variable | Required | Notes |
|----------|----------|-------|
| `DISCORD_TOKEN` | Yes | Bot token from Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Yes | Used when registering slash commands |
| `CLICKUP_API_TOKEN` | Yes | For `/clickup-task` and `/clickup-comment` |
| `CEREBRO_AI_AGENT_TOKEN` | Yes | For mention-based agent API calls |
| `CEREBRO_BASE_URL` | Yes | Cerebro instance URL |
| `GOOGLE_MEET_WEBHOOK_URL` | For meetings | n8n webhook URL (see `meeting.md`) |
| `OPENROUTER_API_KEY` | No | When missing, the bot uses a built-in fallback parser |

`OPENROUTER_MODEL` is forced to free-only usage. Use `openrouter/free` or a model ending with `:free`. Paid model IDs fall back to `openrouter/free` with a warning.

`CEREBRO_TLS_REJECT_UNAUTHORIZED=false` is only for local development with `https://cerebro.test` when Node cannot verify the certificate. Do not use in production.

## Discord setup

1. Create a bot application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Enable the **Message Content Intent** (required for `@mention` questions).
3. Invite the bot to your server with permissions to read/send messages and use slash commands.
4. Run `npm run register` after changing command definitions.

## Project structure

```text
index.js              Discord client and message routing
commands.js           Slash command registration
services/
  aiAgent.js          Natural-language planning and Cerebro execution
  cerebro.js          Cerebro API client
  clickup.js          Direct ClickUp API (slash commands)
  meeting.js          Google Meet scheduling via n8n
  discordFormat.js    Discord message formatting
prompts/
  cerebro-ai-agent.md AI planner system prompt
meeting.md            n8n Google Meet webhook documentation
```

The custom AI planner prompt lives in `prompts/cerebro-ai-agent.md`.

## Deployment

See `deployed.md` for PM2-based production deployment on Ubuntu.
