from __future__ import annotations

import uuid

from security import hash_token, new_token, tokens_match


async def board(client) -> dict:
    return (await client.post("/api/boards", json={"name": "Shared"})).json()


async def share(client, board_id: str, role: str) -> dict:
    res = await client.post(f"/api/boards/{board_id}/share", json={"role": role})
    assert res.status_code == 201, res.text
    return res.json()


async def test_token_helpers():
    a, b = new_token(), new_token()
    assert a != b
    assert len(a) >= 43  # 32 random bytes, urlsafe base64 (>= 128 bits required)
    assert tokens_match(hash_token(a), hash_token(a))
    assert not tokens_match(hash_token(a), hash_token(b))


async def test_resolve_returns_role_and_room(client):
    b = await board(client)
    edit = await share(client, b["id"], "edit")
    view = await share(client, b["id"], "view")

    r_edit = await client.get("/api/rooms/resolve", params={"token": edit["token"]})
    assert r_edit.status_code == 200
    assert r_edit.json()["role"] == "edit"
    assert r_edit.json()["room_id"] == b["id"]

    r_view = await client.get("/api/rooms/resolve", params={"token": view["token"]})
    assert r_view.json()["role"] == "view"
    assert r_view.json()["room_id"] == b["id"]  # same live room for both roles


async def test_token_is_only_returned_once_and_stored_hashed(client):
    b = await board(client)
    link = await share(client, b["id"], "view")
    assert link["token"]

    listing = (await client.get(f"/api/boards/{b['id']}/share")).json()
    assert len(listing) == 1
    assert "token" not in listing[0]
    assert "token_hash" not in listing[0]


async def test_unknown_token_is_404(client):
    res = await client.get("/api/rooms/resolve", params={"token": "x" * 43})
    assert res.status_code == 404


async def test_short_token_rejected(client):
    res = await client.get("/api/rooms/resolve", params={"token": "abc"})
    assert res.status_code == 422


async def test_revoked_link_stops_resolving(client):
    b = await board(client)
    link = await share(client, b["id"], "edit")

    assert (await client.delete(f"/api/share/{link['id']}")).status_code == 204
    res = await client.get("/api/rooms/resolve", params={"token": link["token"]})
    assert res.status_code == 404

    listing = (await client.get(f"/api/boards/{b['id']}/share")).json()
    assert listing[0]["revoked_at"] is not None
    # revoking twice is harmless
    assert (await client.delete(f"/api/share/{link['id']}")).status_code == 204


async def test_rotate_revokes_old_and_keeps_role(client):
    b = await board(client)
    old = await share(client, b["id"], "view")

    rotated = await client.post(f"/api/share/{old['id']}/rotate")
    assert rotated.status_code == 201
    new = rotated.json()
    assert new["token"] != old["token"]
    assert new["role"] == "view"

    assert (await client.get("/api/rooms/resolve", params={"token": old["token"]})).status_code == 404
    ok = await client.get("/api/rooms/resolve", params={"token": new["token"]})
    assert ok.status_code == 200
    assert ok.json()["role"] == "view"


async def test_deleted_board_links_stop_resolving(client):
    b = await board(client)
    link = await share(client, b["id"], "edit")
    await client.delete(f"/api/boards/{b['id']}")
    res = await client.get("/api/rooms/resolve", params={"token": link["token"]})
    assert res.status_code == 404


async def test_share_unknown_board_and_link(client):
    assert (await client.post(f"/api/boards/{uuid.uuid4()}/share", json={"role": "edit"})).status_code == 404
    assert (await client.delete(f"/api/share/{uuid.uuid4()}")).status_code == 404
    assert (await client.post(f"/api/share/{uuid.uuid4()}/rotate")).status_code == 404


async def test_invalid_role_rejected(client):
    b = await board(client)
    res = await client.post(f"/api/boards/{b['id']}/share", json={"role": "admin"})
    assert res.status_code == 422
