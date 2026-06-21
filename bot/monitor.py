import asyncio
import logging
from telethon import events, TelegramClient
from telethon.tl.types import Message

import config
from dedup import storage, engine
from bot.publisher import publish

log = logging.getLogger(__name__)


async def resolve_channels(client: TelegramClient) -> list:
    entities = []
    for ch in config.SOURCE_CHANNELS:
        try:
            entity = await client.get_entity(ch)
            entities.append(entity)
            log.info("Monitoring: %s", ch)
        except Exception as e:
            log.error("Could not resolve channel %s: %s", ch, e)
    return entities


async def handle_message(event: events.NewMessage.Event, client: TelegramClient) -> None:
    msg: Message = event.message
    text = (msg.text or "").strip()

    if not text or len(text) < config.MIN_TEXT_LENGTH:
        return

    source = getattr(event.chat, "username", None) or str(event.chat_id)

    if engine.is_duplicate(text):
        log.debug("Duplicate skipped from %s", source)
        return

    storage.record_message(text, source)
    await publish(client, msg, source)


async def start_monitoring(client: TelegramClient) -> None:
    entities = await resolve_channels(client)
    if not entities:
        raise RuntimeError("No source channels could be resolved. Check SOURCE_CHANNELS in .env")

    @client.on(events.NewMessage(chats=entities))
    async def _handler(event: events.NewMessage.Event) -> None:
        await handle_message(event, client)

    log.info("Listening for new messages on %d channel(s)...", len(entities))

    # Purge stale records once per hour
    async def _purge_loop() -> None:
        while True:
            await asyncio.sleep(3600)
            removed = storage.purge_old_records()
            if removed:
                log.info("Purged %d old records from dedup store", removed)

    asyncio.ensure_future(_purge_loop())
