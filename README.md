# Telegram News Deduplicator

Monitors your Telegram news channels and forwards only **unique** stories to a private channel you control. Runs as a **free GitHub Actions cron job** — no server, no VPS, no monthly cost.

## How it works

1. Every 5 minutes, GitHub runs your script for free
2. It fetches the latest posts from each source channel (public channels only)
3. Checks against everything seen in the last 48 hours using text similarity
4. Unique story → sent to your private Telegram channel via a bot
5. Duplicate (even if reworded) → silently skipped

You just open your output channel in Telegram and scroll once.

---

## Setup — all done in the browser, nothing to install

### Step 1 — Fork this repo

Click **Fork** on GitHub. Your own copy runs the automation for free.

### Step 2 — Create a Telegram bot (2 minutes)

1. Open Telegram → search for **@BotFather**
2. Send `/newbot`, follow the prompts, copy the **bot token** it gives you

### Step 3 — Create your output channel

1. Telegram → New Channel → **Private** → name it "My News Feed"
2. Add your bot as **Admin** with permission to post messages
3. Get the channel ID: forward any message from it to **@userinfobot**, copy the ID (starts with `-100...`)

### Step 4 — Add secrets to your GitHub repo

Go to your forked repo → **Settings → Secrets and variables → Actions → New repository secret**

Add these three secrets:

| Secret name | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | The token from @BotFather |
| `OUTPUT_CHANNEL_ID` | Your channel ID (e.g. `-1001234567890`) |
| `SOURCE_CHANNELS` | Comma-separated channels, e.g. `@bbcnews,@cnn,@reuters` |

### Step 5 — Enable Actions

Go to your forked repo → **Actions tab** → click "I understand my workflows, enable them".

That's it. The job runs every 5 minutes automatically. Free forever on public repos.

---

## Optional tuning

Go to **Settings → Secrets and variables → Actions → Variables** (not Secrets) to add:

| Variable | Default | Effect |
|---|---|---|
| `DEDUP_WINDOW_HOURS` | `48` | How long to remember seen articles |
| `SIMILARITY_THRESHOLD` | `0.6` | 0.0–1.0. Lower = catch more rewording |

- Still seeing duplicates? Set `SIMILARITY_THRESHOLD` to `0.5`
- Unique stories being dropped? Set it to `0.7`

---

## Limitations

- **5-minute delay** — not real-time, but fine for news
- **Public channels only** — channels must have a public `@username` (all major news channels qualify)
- Posts with only images (no text) are skipped — the deduplicator works on text

## Running locally (optional)

```bash
pip install -r requirements.txt
cp .env.example .env   # fill in your values
python run.py
```
