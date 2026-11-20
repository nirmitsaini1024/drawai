from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request, Response

from errors import not_found
from ratelimit import limiter
from repositories import BoardRepository, ShareRepository
from schemas import RoomResolveOut, ShareCreate, ShareLinkCreated, ShareLinkOut
from routers.deps import boards_repo, share_repo

router = APIRouter(tags=["share"])


def room_id_for(board_id: uuid.UUID) -> str:
    # One live room per board; the room id is the board id.
    return str(board_id)


@router.post("/boards/{board_id}/share", response_model=ShareLinkCreated, status_code=201)
async def create_share_link(
    board_id: uuid.UUID,
    body: ShareCreate,
    boards: BoardRepository = Depends(boards_repo),
    shares: ShareRepository = Depends(share_repo),
) -> ShareLinkCreated:
    if await boards.get(board_id) is None:
        raise not_found("Board")
    link, token = await shares.create_link(board_id, body.role)
    return ShareLinkCreated(
        **ShareLinkOut.model_validate(link).model_dump(),
        token=token,
        room_id=room_id_for(board_id),
    )


@router.get("/boards/{board_id}/share", response_model=list[ShareLinkOut])
async def list_share_links(
    board_id: uuid.UUID,
    boards: BoardRepository = Depends(boards_repo),
    shares: ShareRepository = Depends(share_repo),
) -> list[ShareLinkOut]:
    if await boards.get(board_id) is None:
        raise not_found("Board")
    return [ShareLinkOut.model_validate(link) for link in await shares.list_for_board(board_id)]


@router.delete("/share/{link_id}", status_code=204)
async def revoke_share_link(link_id: uuid.UUID, shares: ShareRepository = Depends(share_repo)) -> Response:
    link = await shares.get(link_id)
    if link is None:
        raise not_found("Share link")
    await shares.revoke(link)  # the sync server closes live sockets for revoked links
    return Response(status_code=204)


@router.post("/share/{link_id}/rotate", response_model=ShareLinkCreated, status_code=201)
async def rotate_share_link(link_id: uuid.UUID, shares: ShareRepository = Depends(share_repo)) -> ShareLinkCreated:
    old = await shares.get(link_id)
    if old is None:
        raise not_found("Share link")
    await shares.revoke(old)
    link, token = await shares.create_link(old.board_id, old.role)
    return ShareLinkCreated(
        **ShareLinkOut.model_validate(link).model_dump(),
        token=token,
        room_id=room_id_for(link.board_id),
    )


@router.get("/rooms/resolve", response_model=RoomResolveOut)
@limiter.limit("60/minute")
async def resolve_room(
    request: Request,
    token: str = Query(min_length=16, max_length=256),
    boards: BoardRepository = Depends(boards_repo),
    shares: ShareRepository = Depends(share_repo),
) -> RoomResolveOut:
    link = await shares.find_active_by_token(token)
    if link is None or await boards.get(link.board_id) is None:
        # Same response for unknown, revoked and deleted: don't leak which.
        raise not_found("Share link")
    return RoomResolveOut(
        room_id=room_id_for(link.board_id),
        board_id=link.board_id,
        role=link.role,
        link_id=link.id,
    )
