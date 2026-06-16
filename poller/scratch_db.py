import asyncio
import sys
sys.path.append("/app")
from db import init_db, get_pool

async def main():
    try:
        await init_db()
        pool = await get_pool()
        rows = await pool.fetch("SELECT id, text, sender_name, ts, conversation_key FROM mesh_messages ORDER BY ts DESC LIMIT 5")
        print("MESSAGES IN DATABASE:")
        for r in rows:
            print(f"- [{r['ts']}] {r['sender_name']}: {r['text']} (room: {r['conversation_key']})")
    except Exception as e:
        print("ERROR:", e)

if __name__ == "__main__":
    asyncio.run(main())
