from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response

from errors import ApiError, not_found
from repositories import BoardRepository, ConflictError, DuplicateError
from schemas import BoardCreate, BoardMeta, BoardOut, BoardUpdate
from routers.deps import boards_repo, ensure_size

router = APIRouter(prefix="/boards", tags=["boards"])


@router.get("", response_model=list[BoardMeta])
async def list_boards(repo: BoardRepository = Depends(boards_repo)) -> list[BoardMeta]:
    return [BoardMeta.model_validate(b) for b in await repo.list()]


@router.post("", response_model=BoardOut, status_code=201)
async def create_board(body: BoardCreate, repo: BoardRepository = Depends(boards_repo)) -> BoardOut:
    ensure_size(body.snapshot)
    try:
        board = await repo.create(board_id=body.id, name=body.name, snapshot=body.snapshot)
    except DuplicateError:
        raise ApiError(409, "exists", "A board with this id already exists") from None
    return BoardOut.model_validate(board)


@router.get("/{board_id}", response_model=BoardOut)
async def get_board(board_id: uuid.UUID, repo: BoardRepository = Depends(boards_repo)) -> BoardOut:
    board = await repo.get(board_id)
    if board is None:
        raise not_found("Board")
    return BoardOut.model_validate(board)


@router.put("/{board_id}", response_model=BoardOut)
async def update_board(
    board_id: uuid.UUID,
    body: BoardUpdate,
    repo: BoardRepository = Depends(boards_repo),
) -> BoardOut:
    snapshot_provided = "snapshot" in body.model_fields_set
    if snapshot_provided:
        ensure_size(body.snapshot)
    try:
        board = await repo.update(
            board_id,
            name=body.name,
            snapshot=body.snapshot,
            snapshot_provided=snapshot_provided,
            expected_updated_at=body.expected_updated_at,
        )
    except ConflictError as exc:
        # The client applies last-write-wins using the server copy we return.
        raise ApiError(
            409,
            "conflict",
            "Board was modified on the server since your last sync",
            server=BoardOut.model_validate(exc.current).model_dump(mode="json"),
        ) from None
    if board is None:
        raise not_found("Board")
    return BoardOut.model_validate(board)


@router.delete("/{board_id}", status_code=204)
async def delete_board(board_id: uuid.UUID, repo: BoardRepository = Depends(boards_repo)) -> Response:
    if not await repo.soft_delete(board_id):
        raise not_found("Board")
    return Response(status_code=204)
