import os
from chat_server import create_app, web

os.environ.setdefault("SERVER_ID", "server2")
os.environ.setdefault("PORT", "8002")
os.environ.setdefault("PEER_URL", "ws://localhost:8001/peer")

web.run_app(create_app(), host="0.0.0.0",
            port=int(os.getenv("PORT", "8002")))
