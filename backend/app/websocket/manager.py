import asyncio
import json
from collections import defaultdict
from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        self._connections: dict[str, list[WebSocket]] = defaultdict(list)

    async def connect(self, job_id: str, ws: WebSocket):
        await ws.accept()
        self._connections[job_id].append(ws)

    def disconnect(self, job_id: str, ws: WebSocket):
        if ws in self._connections.get(job_id, []):
            self._connections[job_id].remove(ws)
        if not self._connections.get(job_id):
            self._connections.pop(job_id, None)

    async def broadcast(self, job_id: str, data: dict):
        payload = json.dumps(data)
        dead = []
        for ws in list(self._connections.get(job_id, [])):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            try:
                self.disconnect(job_id, ws)
            except Exception:
                pass

    async def broadcast_all(self, data: dict):
        for job_id in list(self._connections.keys()):
            await self.broadcast(job_id, data)


manager = ConnectionManager()
