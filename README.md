# Telegram News Deduplicator

Monitors your chosen Telegram news channels and forwards only **unique** stories to a private channel you control. No new apps — just open that one channel in Telegram and scroll once.

## How it works

1. Logs into your Telegram account (read-only access to channels you already follow)
2. Receives every new post from your configured source channels
3. Checks it against everything seen in the last 48 hours using text similarity
4. If it's genuinely new → forwards it to your private output channel
5. If it's a duplicate (even if reworded) → silently dropped

## Setup

### 1. Get Telegram API credentials

Go to **https://my.telegram.org/apps**, log in, and create an app.
Copy your **API ID** and **API Hash**.

### 2. Create your output channel in Telegram

- Open Telegram → New Channel → make it **Private**
- Name it something like "My News Feed"
- Copy its username (e.g. `@my_news_feed`) or use its invite link

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=your_hash
TELEGRAM_PHONE=+1234567890
OUTPUT_CHANNEL=@my_news_feed
SOURCE_CHANNELS=@bbcnews,@cnn,@reuters
```

### 5. Run

```bash
python main.py
```

First run: Telegram will ask for your phone number and a login code.
After that, the session is saved and future runs start silently.

### 6. Keep it running

**Option A — your own machine (background):**
```bash
nohup python main.py &> news.log &
```

**Option B — cheap VPS / Raspberry Pi:**
Run the same command, or set it up as a systemd service (see below).

**Option C — free cloud (Railway / Render):**
Deploy as a background worker service using this repo.

#### systemd service (Linux)

```ini
# /etc/systemd/system/news-dedup.service
[Unit]
Description=Telegram News Deduplicator
After=network.target

[Service]
WorkingDirectory=/path/to/NewsAggregator
ExecStart=/usr/bin/python3 main.py
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now news-dedup
```

## Configuration options

| Variable | Default | Description |
|---|---|---|
| `SOURCE_CHANNELS` | required | Comma-separated channel usernames to monitor |
| `OUTPUT_CHANNEL` | required | Your private channel to post unique news |
| `DEDUP_WINDOW_HOURS` | `48` | How long to remember articles |
| `SIMILARITY_THRESHOLD` | `0.6` | 0.0-1.0. Lower = catch more duplicates. Raise if legit news is being skipped. |
| `MIN_TEXT_LENGTH` | `30` | Posts shorter than this (captions, stickers) are always forwarded |

## Tuning similarity

- **Too many duplicates getting through?** Lower `SIMILARITY_THRESHOLD` to `0.5`
- **Unique news being dropped?** Raise it to `0.7` or `0.75`
- The default `0.6` works well for news channels that repost the same story with slightly different wording
