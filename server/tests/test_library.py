from __future__ import annotations

import uuid

CONTENT = {"shapes": [{"id": "shape:1"}], "bindings": [], "assets": [], "schema": {}}


async def test_library_crud(client):
    created = await client.post(
        "/api/library",
        json={"name": "Queue", "category": "Infra", "content": CONTENT, "thumbnail": "data:image/png;base64,AAA"},
    )
    assert created.status_code == 201
    shape = created.json()
    assert shape["category"] == "Infra"

    listing = (await client.get("/api/library")).json()
    assert [s["id"] for s in listing] == [shape["id"]]
    assert listing[0]["content"] == CONTENT

    updated = await client.put(f"/api/library/{shape['id']}", json={"name": "Message queue", "category": "Messaging"})
    assert updated.status_code == 200
    assert updated.json()["name"] == "Message queue"
    assert updated.json()["category"] == "Messaging"
    assert updated.json()["content"] == CONTENT  # untouched

    assert (await client.delete(f"/api/library/{shape['id']}")).status_code == 204
    assert (await client.get("/api/library")).json() == []


async def test_library_client_id_and_duplicates(client):
    sid = str(uuid.uuid4())
    body = {"id": sid, "name": "A", "content": CONTENT}
    assert (await client.post("/api/library", json=body)).status_code == 201
    dup = await client.post("/api/library", json=body)
    assert dup.status_code == 409
    assert dup.json()["code"] == "exists"


async def test_library_missing_items(client):
    missing = uuid.uuid4()
    assert (await client.put(f"/api/library/{missing}", json={"name": "x"})).status_code == 404
    assert (await client.delete(f"/api/library/{missing}")).status_code == 404


async def test_library_requires_content(client):
    res = await client.post("/api/library", json={"name": "No content"})
    assert res.status_code == 422
