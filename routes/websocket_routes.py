import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from routes.deps import decode_token
from services.realtime import manager

router = APIRouter()


@router.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: int):
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4001)
        return
    try:
        claimed_id = decode_token(token)
    except Exception:
        await websocket.close(code=4001)
        return
    if claimed_id != user_id:
        await websocket.close(code=4003)
        return

    await manager.connect(user_id, websocket)
    try:
        while True:
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=25)
            except asyncio.TimeoutError:
                await websocket.send_text('{"type":"ping"}')
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        manager.disconnect(user_id, websocket)
