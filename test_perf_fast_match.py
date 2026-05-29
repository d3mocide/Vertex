import timeit
import json

raws = [
    '{"entity_type": "aircraft", "id": 1}',
    '{"entity_type":"vessel", "id": 2}',
    '{"entity_type" : "aircraft", "id": 3}',
    '{"entity_type": "car", "id": 4}',
] * 1000

def using_json_loads(entity_type):
    entities = []
    for raw in raws:
        entity = json.loads(raw)
        if entity.get("entity_type") == entity_type:
            entities.append(entity)
    return entities

def using_fast_match(entity_type):
    entities = []
    type_matches = [
        f'"entity_type":"{entity_type}"',
        f'"entity_type": "{entity_type}"',
        f'"entity_type" : "{entity_type}"'
    ]
    # In hot loop, use tuple with startswith? No, we check if it's in the string
    for raw in raws:
        if entity_type:
            found = False
            for m in type_matches:
                if m in raw:
                    found = True
                    break
            if not found:
                continue
        entity = json.loads(raw)
        if entity.get("entity_type") == entity_type:
            entities.append(entity)
    return entities

print("using_json_loads:", timeit.timeit("using_json_loads('aircraft')", globals=globals(), number=100))
print("using_fast_match:", timeit.timeit("using_fast_match('aircraft')", globals=globals(), number=100))
