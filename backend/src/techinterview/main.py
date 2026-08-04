"""ASGI app 組裝（T002）。

抽成 `create_app()` 是為了讓契約測試能以 httpx 的 ASGITransport 直接打，
不需啟動真實伺服器（research R-016）。
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from techinterview.api import answers, chat, misc, session
from techinterview.core.errors import AppError

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    app = FastAPI(title="TechInterview Pro — Candidate Portal", version="0.1.0")

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True}

    app.include_router(session.router)
    app.include_router(answers.router)
    app.include_router(chat.router)
    app.include_router(misc.router)

    # 全域錯誤映射（contracts/http-api.md「錯誤格式（全端點共用）」）
    @app.exception_handler(AppError)
    async def handle_app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.status, content=exc.to_body())

    @app.exception_handler(Exception)
    async def handle_unexpected(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled error", exc_info=exc)
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "INTERNAL_ERROR",
                    "message": "系統發生非預期錯誤，你的作答內容已保留，請稍後再試。",
                }
            },
        )

    return app


app = create_app()


def main() -> None:
    import uvicorn

    from techinterview.core.config import get_settings
    from techinterview.db.client import run_migrations

    settings = get_settings()
    run_migrations()
    uvicorn.run(
        "techinterview.main:app",
        host="127.0.0.1",
        port=settings.port,
        reload=settings.environment == "development",
    )


if __name__ == "__main__":
    main()
