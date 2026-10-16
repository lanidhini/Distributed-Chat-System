import os

os.environ["SERVER_ID"] = "server2"
os.environ.setdefault("PORT", "8002")
os.environ.setdefault("PEER_URL", "ws://localhost:8001/peer")

from chat_server import create_app, web

web.run_app(create_app(), host="0.0.0.0",
            port=int(os.getenv("PORT", "8002")))
