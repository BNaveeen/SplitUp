import asyncio
import json
from typing import Dict, List, Optional
from fastapi import WebSocket

try:
    import redis.asyncio as aioredis
    _redis_available = True
except ImportError:
    _redis_available = False

_main_loop: Optional[asyncio.AbstractEventLoop] = None


def set_event_loop(loop: asyncio.AbstractEventLoop):
    global _main_loop
    _main_loop = loop


def get_event_loop() -> Optional[asyncio.AbstractEventLoop]:
    return _main_loop


class ConnectionManager:
    """
    Manages WebSocket connections. Uses Redis pub/sub for fan-out when REDIS_URL
    is configured — required for multi-worker deployments. Falls back to
    in-memory routing (single instance only) when Redis is not available.
    """

    def __init__(self):
        self.active: Dict[int, List[WebSocket]] = {}
        self._redis = None
        self._pubsub_task: Optional[asyncio.Task] = None

    async def setup_redis(self, redis_url: str):
        self._redis = aioredis.from_url(redis_url, decode_responses=True)
        self._pubsub_task = asyncio.create_task(self._listen_pubsub())

    async def _listen_pubsub(self):
        pubsub = self._redis.pubsub()
        await pubsub.subscribe("ws_broadcast")
        async for message in pubsub.listen():
            if message["type"] == "message":
                try:
                    payload = json.loads(message["data"])
                    await self._send_local(int(payload["user_id"]), payload["data"])
                except Exception:
                    pass

    async def connect(self, user_id: int, websocket: WebSocket):
        await websocket.accept()
        self.active.setdefault(user_id, []).append(websocket)

    def disconnect(self, user_id: int, websocket: WebSocket):
        conns = self.active.get(user_id, [])
        if websocket in conns:
            conns.remove(websocket)

    async def _send_local(self, user_id: int, data: dict):
        dead = []
        for ws in list(self.active.get(user_id, [])):
            try:
                await ws.send_text(json.dumps(data))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(user_id, ws)

    async def send_to_user(self, user_id: int, data: dict):
        if self._redis:
            await self._redis.publish("ws_broadcast", json.dumps({"user_id": user_id, "data": data}))
        else:
            await self._send_local(user_id, data)

    async def broadcast_to_users(self, user_ids: List[int], data: dict):
        if self._redis:
            async with self._redis.pipeline(transaction=False) as pipe:
                for uid in user_ids:
                    pipe.publish("ws_broadcast", json.dumps({"user_id": uid, "data": data}))
                await pipe.execute()
        else:
            for uid in user_ids:
                await self._send_local(uid, data)


manager = ConnectionManager()
