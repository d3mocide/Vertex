import timeit
import json

raws = [
    b'{"entity_type": "aircraft", "id": 1}',
    b'{"entity_type":"vessel", "id": 2}',
    b'{"entity_type"  : "aircraft", "id": 3}',
    b'{"entity_type": "car", "id": 4}',
    '{"entity_type": "truck", "id": 5}',
    '{"entity_type": "bus", "id": 6}',
    '{"entity_type": "train", "id": 7}',
    '{"entity_type": "bicycle", "id": 8}',
] * 500

def original_get_all_entities(entity_type):
    entities = []
    for raw in raws:
        try:
            entities.append(json.loads(raw))
        except (json.JSONDecodeError, TypeError):
            continue

    if entity_type:
        entities = [e for e in entities if e.get("entity_type") == entity_type]
    return entities

def optimized_get_all_entities(entity_type):
    type_bytes = entity_type.encode() if entity_type else b""
    type_str = entity_type or ""

    entities = []
    for raw in raws:
        if entity_type:
            # Check fast matching, account for bytes/str
            if isinstance(raw, bytes):
                if b'"entity_type"' not in raw or type_bytes not in raw:
                    continue
            elif isinstance(raw, str):
                if '"entity_type"' not in raw or type_str not in raw:
                    continue

        try:
            entity = json.loads(raw)
            if entity_type and entity.get("entity_type") != entity_type:
                continue
            entities.append(entity)
        except (json.JSONDecodeError, TypeError):
            continue

    return entities

print("Original:", timeit.timeit("original_get_all_entities('aircraft')", globals=globals(), number=100))
print("Optimized:", timeit.timeit("optimized_get_all_entities('aircraft')", globals=globals(), number=100))

# Ensure they return the same
assert original_get_all_entities('aircraft') == optimized_get_all_entities('aircraft')
