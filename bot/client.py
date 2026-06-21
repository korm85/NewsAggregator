from telethon import TelegramClient
import config


def create_client() -> TelegramClient:
    return TelegramClient(config.SESSION_NAME, config.API_ID, config.API_HASH)
