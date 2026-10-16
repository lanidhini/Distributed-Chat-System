const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  maxHttpBufferSize: 1e6
});

const PORT = process.env.PORT || 3000;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_USERNAME_LENGTH = 24;
const MAX_HISTORY = 100;

const users = new Map();
const messageHistory = [];

app.disable("x-powered-by");

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "distributed-chat-system",
    connectedUsers: users.size
  });
});

function cleanText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function getUniqueUsername(requestedName, socketId) {
  const baseName =
    cleanText(requestedName)
      .replace(/\s+/g, " ")
      .slice(0, MAX_USERNAME_LENGTH) || "Guest";

  const existingNames = new Set(
    [...users.entries()]
      .filter(([id]) => id !== socketId)
      .map(([, user]) => user.username.toLowerCase())
  );

  if (!existingNames.has(baseName.toLowerCase())) {
    return baseName;
  }

  let suffix = 2;
  let candidate = "";

  do {
    const ending = ` (${suffix})`;
    candidate =
      baseName.slice(0, MAX_USERNAME_LENGTH - ending.length) + ending;
    suffix += 1;
  } while (existingNames.has(candidate.toLowerCase()));

  return candidate;
}

function getPublicUsers() {
  return [...users.values()].map((user) => ({
    username: user.username,
    joinedAt: user.joinedAt
  }));
}

function broadcastUsers() {
  io.emit("users:update", getPublicUsers());
}

function createMessage({ username, text, type = "message" }) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    username,
    text,
    type,
    timestamp: new Date().toISOString()
  };
}

function broadcastSystemMessage(text) {
  const message = createMessage({
    username: "System",
    text,
    type: "system"
  });

  messageHistory.push(message);

  if (messageHistory.length > MAX_HISTORY) {
    messageHistory.shift();
  }

  io.emit("message:new", message);
}

io.on("connection", (socket) => {
  socket.on("user:join", (requestedName, callback) => {
    if (users.has(socket.id)) {
      if (typeof callback === "function") {
        callback({
          ok: true,
          username: users.get(socket.id).username
        });
      }

      return;
    }

    const username = getUniqueUsername(requestedName, socket.id);

    users.set(socket.id, {
      username,
      joinedAt: new Date().toISOString()
    });

    socket.emit("history:load", messageHistory);
    broadcastUsers();

    broadcastSystemMessage(`${username} joined the chat.`);

    if (typeof callback === "function") {
      callback({
        ok: true,
        username
      });
    }
  });

  socket.on("message:send", (incomingText, callback) => {
    const user = users.get(socket.id);

    if (!user) {
      if (typeof callback === "function") {
        callback({
          ok: false,
          error: "Join the chat before sending a message."
        });
      }

      return;
    }

    const text = cleanText(incomingText);

    if (!text) {
      return;
    }

    if (text.length > MAX_MESSAGE_LENGTH) {
      if (typeof callback === "function") {
        callback({
          ok: false,
          error: `Messages cannot exceed ${MAX_MESSAGE_LENGTH} characters.`
        });
      }

      return;
    }

    const message = createMessage({
      username: user.username,
      text
    });

    messageHistory.push(message);

    if (messageHistory.length > MAX_HISTORY) {
      messageHistory.shift();
    }

    io.emit("message:new", message);

    if (typeof callback === "function") {
      callback({ ok: true });
    }
  });

  socket.on("typing:update", (isTyping) => {
    const user = users.get(socket.id);

    if (!user) {
      return;
    }

    socket.broadcast.emit("typing:update", {
      username: user.username,
      isTyping: Boolean(isTyping)
    });
  });

  socket.on("disconnect", () => {
    const user = users.get(socket.id);

    if (!user) {
      return;
    }

    users.delete(socket.id);

    broadcastUsers();
    broadcastSystemMessage(`${user.username} left the chat.`);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Distributed Chat System is running on port ${PORT}`);
});
