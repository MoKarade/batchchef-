from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.websocket.manager import manager

router = APIRouter()


@router.websocket("/ws/jobs/{job_id}")
async def websocket_job_progress(job_id: str, ws: WebSocket):
    await manager.connect(job_id, ws)
    try:
        while True:
            await ws.receive_text()  # keep-alive; client may send pings
    except WebSocketDisconnect:
        manager.disconnect(job_id, ws)
