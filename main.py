import asyncio
import logging
import config
from dedup import storage
from bot.client import create_client
from bot.monitor import start_monitoring

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)


async def main() -> None:
    storage.init_db()
    log.info("Dedup store ready.")

    client = create_client()
    await client.start(phone=config.PHONE)
    log.info("Telegram session started.")

    await start_monitoring(client)
    await client.run_until_disconnected()


if __name__ == "__main__":
    asyncio.run(main())
