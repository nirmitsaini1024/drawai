"""Consistent JSON error shape: {"detail": str, "code": str, ...extra}."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, detail: str, **extra: Any) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.code = code
        self.detail = detail
        self.extra = extra


def not_found(what: str) -> ApiError:
    return ApiError(404, "not_found", f"{what} not found")


def too_large(limit: int) -> ApiError:
    return ApiError(413, "payload_too_large", f"Snapshot exceeds the {limit // (1024 * 1024)} MB limit")


def _body(status: int, code: str, detail: str, **extra: Any) -> JSONResponse:
    return JSONResponse(status_code=status, content={"detail": detail, "code": code, **extra})


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return _body(exc.status_code, exc.code, exc.detail, **exc.extra)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return _body(exc.status_code, f"http_{exc.status_code}", str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [
            {"loc": [str(p) for p in e.get("loc", ())], "msg": e.get("msg", "")} for e in exc.errors()
        ]
        first = errors[0] if errors else {"loc": [], "msg": "invalid request"}
        detail = f"{'.'.join(first['loc'])}: {first['msg']}" if first["loc"] else first["msg"]
        return _body(422, "validation_error", detail, errors=errors)
