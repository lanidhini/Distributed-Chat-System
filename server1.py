import os
from chat_server import create_app, web

os.environ.setdefault("SERVER_ID", "server1")
os.environ.setdefault("PORT", "8001")
os.environ.setdefault("PEER_URL", "ws://localhost:8002/peer")

web.run_app(create_app(), host="0.0.0.0",
            port=int(os.getenv("PORT", "8001")))
