from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from redis_bus import subscribe_updates, get_all_entities

router = APIRouter(tags=["websocket"])


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    pubsub = await subscribe_updates()
    try:
        entities = await get_all_entities()
        await ws.send_json({"type": "snapshot", "data": entities})

        async for message in pubsub.listen():
            if message["type"] == "message":
                await ws.send_text(message["data"])
    except WebSocketDisconnect:
        pass
    finally:
        await pubsub.unsubscribe("civic:updates")
        await pubsub.aclose()
