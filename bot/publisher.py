import logging
from telethon import TelegramClient
from telethon.tl.types import Message

import config

log = logging.getLogger(__name__)

_output_entity = None


async def _get_output(client: TelegramClient):
    global _output_entity
    if _output_entity is None:
        _output_entity = await client.get_entity(config.OUTPUT_CHANNEL)
    return _output_entity


async def publish(client: TelegramClient, msg: Message, source: str) -> None:
    output = await _get_output(client)
    try:
        # Forward preserves media (photos, videos) attached to the post
        await client.forward_messages(output, msg)
        log.info("Forwarded unique post from %s", source)
    except Exception as e:
        log.error("Failed to forward message from %s: %s", source, e)
