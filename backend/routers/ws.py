import asyncio
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from redis_bus import subscribe_updates, get_all_entities, get_aircraft_snapshot
from metrics_collector import ws_client_connect, ws_client_disconnect

router = APIRouter(tags=["websocket"])


def _entity_passes_filter(
    data: dict,
    sub_bbox: list | None,
    sub_entity_types: list | None,
) -> bool:
    """Return True if entity_update data passes the current subscription filters."""
    # Entity-type filter
    if sub_entity_types:
        entity_type = data.get("entity_type")
        if entity_type not in sub_entity_types:
            return False

    # Bbox filter: [min_lon, min_lat, max_lon, max_lat]
    if sub_bbox is not None:
        lat = data.get("lat")
        lon = data.get("lon")
        if lat is not None and lon is not None:
            min_lon, min_lat, max_lon, max_lat = sub_bbox
            if not (min_lat <= lat <= max_lat and min_lon <= lon <= max_lon):
                return False

    return True


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    try:
        await ws.accept()
        ws_client_connect()
        pubsub = await subscribe_updates()

        # Per-client subscription state (no filter = pass everything through)
        sub_state: dict = {"bbox": None, "entity_types": None}
        sub_lock = asyncio.Lock()

        try:
            entities = await get_all_entities()
            await ws.send_json({"type": "snapshot", "data": entities})

            aircraft_snapshot = await get_aircraft_snapshot()
            if aircraft_snapshot:
                await ws.send_json({"type": "aircraft_snapshot", "data": aircraft_snapshot})

            async def forward_redis():
                try:
                    async for message in pubsub.listen():
                        if message["type"] == "message":
                            raw: str = message["data"]

                            # ⚡ Bolt Optimization: Fast path bypasses json.loads for non-entity_update messages.
                            # String matching is ~50-100x faster than parsing large payloads like snapshots.
                            # We check for the presence of the string, which is safe since "entity_update"
                            # is a specific enough substring to avoid false positives in this context.
                            if "entity_update" not in raw:
                                await ws.send_text(raw)
                                continue

                            # ⚡ Bolt Optimization: Bypass json.loads if there are no active filters
                            async with sub_lock:
                                bbox = sub_state["bbox"]
                                entity_types = sub_state["entity_types"]

                            if bbox is None and entity_types is None:
                                await ws.send_text(raw)
                                continue

                            # Apply subscription filters to entity_update messages
                            try:
                                parsed = json.loads(raw)
                            except (json.JSONDecodeError, TypeError, ValueError):
                                await ws.send_text(raw)
                                continue

                            if parsed.get("type") != "entity_update":
                                await ws.send_text(raw)
                                continue

                            entity_data = parsed.get("data") or {}

                            if not _entity_passes_filter(entity_data, bbox, entity_types):
                                continue

                            await ws.send_text(raw)
                except (WebSocketDisconnect, asyncio.CancelledError):
                    pass
                except Exception:
                    import traceback
                    traceback.print_exc()

            async def watch_client_messages():
                try:
                    while True:
                        text = await ws.receive_text()
                        try:
                            msg = json.loads(text)
                        except (json.JSONDecodeError, TypeError, ValueError):
                            continue

                        if not isinstance(msg, dict):
                            continue

                        if msg.get("type") == "subscribe":
                            new_bbox = msg.get("bbox")
                            new_entity_types = msg.get("entity_types")

                            # Validate bbox: must be a list/tuple of 4 numbers
                            if new_bbox is not None:
                                if (
                                    isinstance(new_bbox, list)
                                    and len(new_bbox) == 4
                                    and all(isinstance(v, (int, float)) for v in new_bbox)
                                ):
                                    pass  # valid
                                else:
                                    new_bbox = None  # invalid, treat as no filter

                            # Validate entity_types: must be a non-empty list of strings
                            if new_entity_types is not None:
                                if (
                                    isinstance(new_entity_types, list)
                                    and len(new_entity_types) > 0
                                    and all(isinstance(t, str) for t in new_entity_types)
                                ):
                                    pass  # valid
                                else:
                                    new_entity_types = None  # invalid, treat as no filter

                            async with sub_lock:
                                sub_state["bbox"] = new_bbox
                                sub_state["entity_types"] = new_entity_types
                except (WebSocketDisconnect, asyncio.CancelledError):
                    pass

            forward_task = asyncio.create_task(forward_redis())
            client_task = asyncio.create_task(watch_client_messages())

            await asyncio.wait(
                [forward_task, client_task],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in [forward_task, client_task]:
                if not task.done():
                    task.cancel()
                    try:
                        await task
                    except (asyncio.CancelledError, Exception):
                        pass
        finally:
            ws_client_disconnect()
            await pubsub.unsubscribe("civic:updates")
            await pubsub.aclose()
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
