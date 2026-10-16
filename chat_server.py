import asyncio
import json
import os
import time
import uuid
from collections import deque
from pathlib import Path

from aiohttp import ClientSession, WSMsgType, web

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"

SERVER_ID = os.getenv("SERVER_ID", "server1")
PORT = int(os.getenv("PORT", "8001"))
PEER_URL = os.getenv("PEER_URL", "")
SERVER_URLS = [
    url.strip().rstrip("/")
    for url in os.getenv(
        "CHAT_SERVER_URLS",
        "http://localhost:8001,http://localhost:8002"
    ).split(",")
    if url.strip()
]

MAX_MESSAGE_LENGTH = 1000
MAX_USERNAME_LENGTH = 24
MAX_HISTORY = 100

clients = {}
remote_users = {}
history = deque(maxlen=MAX_HISTORY)
peer_socket = None
peer_task = None
peer_ready = asyncio.Event()
message_lock = asyncio.Lock()
sequence = 0


def send_json(ws, data):
    return ws.send_str(json.dumps(data))


def local_user_list():
    return [
        {"username": user["username"], "server": SERVER_ID}
        for user in clients.values()
    ]


def all_user_list():
    users = local_user_list() + list(remote_users.values())
    unique = {}
    for user in users:
        key = (user["username"].lower(), user["server"])
        unique[key] = user
    return list(unique.values())


async def broadcast_local(data):
    dead = []
    for ws in list(clients):
        try:
            await send_json(ws, data)
        except Exception:
            dead.append(ws)

    for ws in dead:
        clients.pop(ws, None)


async def send_peer(data):
    if peer_socket is not None and not peer_socket.closed:
        try:
            await send_json(peer_socket, data)
        except Exception:
            pass


async def publish_users():
    await broadcast_local({
        "type": "users",
        "users": all_user_list(),
        "server": SERVER_ID
    })
    await send_peer({
        "type": "peer_users",
        "server": SERVER_ID,
        "users": local_user_list()
    })


def unique_username(requested):
    name = " ".join(str(requested or "Guest").split())
    name = name[:MAX_USERNAME_LENGTH] or "Guest"

    taken = {
        user["username"].lower()
        for user in all_user_list()
    }

    if name.lower() not in taken:
        return name

    suffix = 2
    while True:
        ending = f" ({suffix})"
        candidate = name[:MAX_USERNAME_LENGTH - len(ending)] + ending
        if candidate.lower() not in taken:
            return candidate
        suffix += 1


async def create_message(username, text):
    global sequence
    async with message_lock:
        sequence += 1
        message = {
            "id": f"{SERVER_ID}-{sequence}-{uuid.uuid4().hex[:6]}",
            "username": username,
            "text": text,
            "server": SERVER_ID,
            "timestamp": time.time(),
            "type": "message"
        }
        history.append(message)
        return message


async def deliver_message(message, forward=True):
    await broadcast_local({"type": "message", "message": message})
    if forward:
        await send_peer({"type": "peer_message", "message": message})


async def peer_connection(app):
    global peer_socket

    if not PEER_URL:
        while True:
            await asyncio.sleep(5)

    while True:
        try:
            async with app["session"].ws_connect(
                PEER_URL, heartbeat=20
            ) as ws:
                peer_socket = ws
                peer_ready.set()

                await send_json(ws, {
                    "type": "peer_users",
                    "server": SERVER_ID,
                    "users": local_user_list()
                })

                async for packet in ws:
                    if packet.type != WSMsgType.TEXT:
                        if packet.type in (
                            WSMsgType.CLOSED,
                            WSMsgType.ERROR
                        ):
                            break
                        continue

                    try:
                        data = json.loads(packet.data)
                    except json.JSONDecodeError:
                        continue

                    if data.get("type") == "peer_users":
                        if data.get("server") != SERVER_ID:
                            remote_users.clear()
                            for user in data.get("users", []):
                                if isinstance(user, dict):
                                    remote_users[
                                        f'{user.get("server")}:{user.get("username")}'
                                    ] = user
                            await broadcast_local({
                                "type": "users",
                                "users": all_user_list(),
                                "server": SERVER_ID
                            })

                    elif data.get("type") == "peer_message":
                        message = data.get("message")
                        if isinstance(message, dict):
                            if not any(
                                old.get("id") == message.get("id")
                                for old in history
                            ):
                                history.append(message)
                                await deliver_message(message, forward=False)

        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print(f"[{SERVER_ID}] Peer connection unavailable: {exc}")
        finally:
            peer_socket = None
            peer_ready.clear()

        await asyncio.sleep(3)


async def websocket_handler(request):
    ws = web.WebSocketResponse(heartbeat=30, max_msg_size=10000)
    await ws.prepare(request)

    username = None
    clients[ws] = {"username": "Guest"}

    await send_json(ws, {
        "type": "history",
        "messages": list(history)
    })
    await publish_users()

    try:
        async for packet in ws:
            if packet.type != WSMsgType.TEXT:
                continue

            try:
                data = json.loads(packet.data)
            except json.JSONDecodeError:
                continue

            event = data.get("type")

            if event == "join":
                username = unique_username(data.get("username"))
                clients[ws] = {"username": username}
                await send_json(ws, {
                    "type": "joined",
                    "username": username,
                    "server": SERVER_ID
                })
                await publish_users()
                await broadcast_local({
                    "type": "system",
                    "text": f"{username} joined {SERVER_ID}."
                })

            elif event == "message":
                if not username:
                    await send_json(ws, {
                        "type": "error",
                        "text": "Join the chat before sending messages."
                    })
                    continue

                text = data.get("text", "")
                if not isinstance(text, str):
                    continue

                text = text.strip()
                if not text:
                    continue

                if len(text) > MAX_MESSAGE_LENGTH:
                    await send_json(ws, {
                        "type": "error",
                        "text": "Messages cannot exceed 1000 characters."
                    })
                    continue

                message = await create_message(username, text)
                await deliver_message(message)

            elif event == "typing":
                if username:
                    await send_peer({
                        "type": "peer_typing",
                        "username": username,
                        "server": SERVER_ID,
                        "typing": bool(data.get("typing"))
                    })
                    await broadcast_local({
                        "type": "typing",
                        "username": username,
                        "server": SERVER_ID,
                        "typing": bool(data.get("typing"))
                    })

    finally:
        old_user = clients.pop(ws, None)
        if old_user and username:
            await publish_users()
            await broadcast_local({
                "type": "system",
                "text": f"{username} left {SERVER_ID}."
            })

    return ws


async def peer_handler(request):
    global peer_socket

    ws = web.WebSocketResponse(heartbeat=20, max_msg_size=10000)
    await ws.prepare(request)

    await send_json(ws, {
        "type": "peer_users",
        "server": SERVER_ID,
        "users": local_user_list()
    })

    async for packet in ws:
        if packet.type != WSMsgType.TEXT:
            continue

        try:
            data = json.loads(packet.data)
        except json.JSONDecodeError:
            continue

        if data.get("type") == "peer_users":
            if data.get("server") != SERVER_ID:
                remote_users.clear()
                for user in data.get("users", []):
                    if isinstance(user, dict):
                        remote_users[
                            f'{user.get("server")}:{user.get("username")}'
                        ] = user
                await broadcast_local({
                    "type": "users",
                    "users": all_user_list(),
                    "server": SERVER_ID
                })

        elif data.get("type") == "peer_message":
            message = data.get("message")
            if isinstance(message, dict):
                if not any(
                    old.get("id") == message.get("id")
                    for old in history
                ):
                    history.append(message)
                    await deliver_message(message, forward=False)

        elif data.get("type") == "peer_typing":
            await broadcast_local({
                "type": "typing",
                "username": data.get("username", "Someone"),
                "server": data.get("server", "remote"),
                "typing": bool(data.get("typing"))
            })

    return ws


async def config_handler(request):
    return web.Response(
        text="window.CHAT_SERVER_URLS = " + json.dumps(SERVER_URLS) + ";",
        content_type="application/javascript"
    )


async def health_handler(request):
    return web.json_response({
        "status": "ok",
        "server": SERVER_ID,
        "local_users": len(clients),
        "peer_connected": peer_socket is not None and not peer_socket.closed
    })


async def startup(app):
    app["session"] = ClientSession()
    app["peer_task"] = asyncio.create_task(peer_connection(app))


async def cleanup(app):
    app["peer_task"].cancel()
    try:
        await app["peer_task"]
    except asyncio.CancelledError:
        pass
    await app["session"].close()


def create_app():
    app = web.Application()
    app.router.add_get("/ws", websocket_handler)
    app.router.add_get("/peer", peer_handler)
    app.router.add_get("/config.js", config_handler)
    app.router.add_get("/health", health_handler)
    app.router.add_static("/", str(PUBLIC), show_index=True)
    app.on_startup.append(startup)
    app.on_cleanup.append(cleanup)
    return app


if __name__ == "__main__":
    web.run_app(create_app(), host="0.0.0.0", port=PORT)
