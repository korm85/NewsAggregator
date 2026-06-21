# Telegram News Deduplicator

Monitors 6 Telegram news channels and forwards only **unique** stories to your private AggregatedNews channel. Runs as a free GitHub Actions cron job every 5 minutes — no server, no VPS, no monthly cost.

## Source channels monitored

- @salehdesk1
- @abualiexpress
- @arabworld301news
- @ynetalerts
- @firstreportsnews
- @hapaklive

## Setup — one step

Go to **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret name | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | your bot token from @BotFather |

Then go to the **Actions tab** and enable workflows. Done.

The job runs every 5 minutes automatically. To test immediately, go to Actions → News Dedup → Run workflow.

---

## How it works

1. Every 5 minutes GitHub fetches the latest posts from all 6 channels
2. Each post is checked against everything seen in the last 48 hours
3. Exact duplicates are caught by SHA-256 hash
4. Reworded duplicates are caught by Jaccard shingle similarity (threshold: 0.6)
5. Only unique posts are forwarded to AggregatedNews

## Tuning

Edit `channels.json` to add/remove source channels or change the output channel.

Set these as GitHub **Variables** (not Secrets) to tune deduplication:

| Variable | Default | Effect |
|---|---|---|
| `DEDUP_WINDOW_HOURS` | `48` | How long to remember seen articles |
| `SIMILARITY_THRESHOLD` | `0.6` | Lower = catch more rewording, higher = stricter |
