from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response

from errors import ApiError, not_found
from repositories import DuplicateError, LibraryRepository
from schemas import LibraryShapeCreate, LibraryShapeOut, LibraryShapeUpdate
from routers.deps import ensure_size, library_repo

router = APIRouter(prefix="/library", tags=["library"])


@router.get("", response_model=list[LibraryShapeOut])
async def list_library(repo: LibraryRepository = Depends(library_repo)) -> list[LibraryShapeOut]:
    return [LibraryShapeOut.model_validate(s) for s in await repo.list()]


@router.post("", response_model=LibraryShapeOut, status_code=201)
async def create_shape(
    body: LibraryShapeCreate, repo: LibraryRepository = Depends(library_repo)
) -> LibraryShapeOut:
    ensure_size(body.content)
    try:
        shape = await repo.create(
            shape_id=body.id,
            name=body.name,
            category=body.category,
            content=body.content,
            thumbnail=body.thumbnail,
            created_at=body.created_at,
        )
    except DuplicateError:
        raise ApiError(409, "exists", "A library shape with this id already exists") from None
    return LibraryShapeOut.model_validate(shape)


@router.put("/{shape_id}", response_model=LibraryShapeOut)
async def update_shape(
    shape_id: uuid.UUID,
    body: LibraryShapeUpdate,
    repo: LibraryRepository = Depends(library_repo),
) -> LibraryShapeOut:
    fields = body.model_dump(exclude_unset=True, exclude_none=True)
    if "content" in fields:
        ensure_size(fields["content"])
    shape = await repo.update(shape_id, fields)
    if shape is None:
        raise not_found("Library shape")
    return LibraryShapeOut.model_validate(shape)


@router.delete("/{shape_id}", status_code=204)
async def delete_shape(shape_id: uuid.UUID, repo: LibraryRepository = Depends(library_repo)) -> Response:
    if not await repo.delete(shape_id):
        raise not_found("Library shape")
    return Response(status_code=204)
