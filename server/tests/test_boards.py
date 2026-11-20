from __future__ import annotations

import uuid

import config


async def make_board(client, **body):
    res = await client.post("/api/boards", json=body or {"name": "First"})
    assert res.status_code == 201, res.text
    return res.json()


async def test_health_checks_db(client):
    res = await client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["db"] == "ok"


async def test_board_crud(client, snapshot):
    board = await make_board(client, name="Roadmap", snapshot=snapshot)
    assert board["name"] == "Roadmap"
    assert board["snapshot"] == snapshot

    listing = (await client.get("/api/boards")).json()
    assert [b["id"] for b in listing] == [board["id"]]
    assert "snapshot" not in listing[0]  # list is metadata only

    got = (await client.get(f"/api/boards/{board['id']}")).json()
    assert got["snapshot"] == snapshot

    res = await client.put(f"/api/boards/{board['id']}", json={"name": "Renamed"})
    assert res.status_code == 200
    assert res.json()["name"] == "Renamed"
    assert res.json()["snapshot"] == snapshot  # untouched when omitted
    assert res.json()["updated_at"] >= board["updated_at"]

    assert (await client.delete(f"/api/boards/{board['id']}")).status_code == 204
    assert (await client.get(f"/api/boards/{board['id']}")).status_code == 404
    assert (await client.get("/api/boards")).json() == []  # soft-deleted boards are hidden


async def test_create_with_client_id_is_not_duplicated(client):
    bid = str(uuid.uuid4())
    assert (await client.post("/api/boards", json={"id": bid, "name": "A"})).status_code == 201
    dup = await client.post("/api/boards", json={"id": bid, "name": "A"})
    assert dup.status_code == 409
    assert dup.json()["code"] == "exists"


async def test_recreating_a_deleted_board_revives_it(client, snapshot):
    bid = str(uuid.uuid4())
    await client.post("/api/boards", json={"id": bid, "name": "Old"})
    await client.delete(f"/api/boards/{bid}")
    res = await client.post("/api/boards", json={"id": bid, "name": "Edited offline", "snapshot": snapshot})
    assert res.status_code == 201
    assert res.json()["name"] == "Edited offline"
    assert (await client.get(f"/api/boards/{bid}")).status_code == 200


async def test_put_conflict_returns_server_copy(client, snapshot):
    board = await make_board(client, name="Shared")
    seen = board["updated_at"]

    # Another device saves first.
    other = await client.put(
        f"/api/boards/{board['id']}",
        json={"snapshot": snapshot, "expected_updated_at": seen},
    )
    assert other.status_code == 200

    # We still hold the old updated_at -> 409 with the server's copy.
    stale = await client.put(
        f"/api/boards/{board['id']}",
        json={"name": "Mine", "expected_updated_at": seen},
    )
    assert stale.status_code == 409
    body = stale.json()
    assert body["code"] == "conflict"
    assert body["server"]["snapshot"] == snapshot
    assert body["server"]["updated_at"] == other.json()["updated_at"]

    # Last-write-wins: client retries against the server's updated_at.
    retry = await client.put(
        f"/api/boards/{board['id']}",
        json={"name": "Mine", "expected_updated_at": body["server"]["updated_at"]},
    )
    assert retry.status_code == 200
    assert retry.json()["name"] == "Mine"


async def test_put_without_expected_is_unconditional(client):
    board = await make_board(client, name="X")
    res = await client.put(f"/api/boards/{board['id']}", json={"name": "Y"})
    assert res.status_code == 200


async def test_update_missing_board_is_404(client):
    res = await client.put(f"/api/boards/{uuid.uuid4()}", json={"name": "x"})
    assert res.status_code == 404
    assert res.json()["code"] == "not_found"


async def test_validation_error_shape(client):
    res = await client.post("/api/boards", json={"name": ""})
    assert res.status_code == 422
    body = res.json()
    assert body["code"] == "validation_error"
    assert isinstance(body["detail"], str)


async def test_snapshot_size_limit(client, monkeypatch):
    monkeypatch.setattr(config, "MAX_SNAPSHOT_BYTES", 200)
    res = await client.post("/api/boards", json={"name": "Big", "snapshot": {"blob": "x" * 500}})
    assert res.status_code == 413
    assert res.json()["code"] == "payload_too_large"


async def test_large_responses_are_gzipped(client):
    board = await make_board(client, name="Big", snapshot={"blob": "x" * 5000})
    res = await client.get(f"/api/boards/{board['id']}", headers={"Accept-Encoding": "gzip"})
    assert res.headers.get("content-encoding") == "gzip"
    assert res.json()["snapshot"]["blob"] == "x" * 5000
