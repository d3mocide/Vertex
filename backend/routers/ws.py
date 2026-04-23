import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from redis_bus import subscribe_updates, get_all_entities

router = APIRouter(tags=["websocket"])


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    try:
        await ws.accept()
        pubsub = await subscribe_updates()
        try:
            entities = await get_all_entities()
            await ws.send_json({"type": "snapshot", "data": entities})

            async def forward_redis():
                try:
                    async for message in pubsub.listen():
                        if message["type"] == "message":
                            await ws.send_text(message["data"])
                except (WebSocketDisconnect, asyncio.CancelledError):
                    pass
                except Exception:
                    import traceback
                    traceback.print_exc()

            async def watch_disconnect():
                try:
                    while True:
                        await ws.receive_text()
                except (WebSocketDisconnect, asyncio.CancelledError):
                    pass

            forward_task = asyncio.create_task(forward_redis())
            disconnect_task = asyncio.create_task(watch_disconnect())

            await asyncio.wait(
                [forward_task, disconnect_task],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in [forward_task, disconnect_task]:
                if not task.done():
                    task.cancel()
                    try:
                        await task
                    except (asyncio.CancelledError, Exception):
                        pass
        finally:
            await pubsub.unsubscribe("civic:updates")
            await pubsub.aclose()
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
