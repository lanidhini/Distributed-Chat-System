(() => {
  "use strict";

  const urls = Array.isArray(window.CHAT_SERVER_URLS)
    ? window.CHAT_SERVER_URLS
    : [window.location.origin];

  const messages = document.getElementById("messages");
  const form = document.getElementById("message-form");
  const input = document.getElementById("message-input");
  const sendButton = document.getElementById("send-button");
  const status = document.getElementById("connection-status");
  const statusDot = document.getElementById("status-dot");
  const serverLabel = document.getElementById("server-label");
  const members = document.getElementById("members-list");
  const memberCount = document.getElementById("member-count");
  const typing = document.getElementById("typing");
  const modal = document.getElementById("username-modal");
  const usernameForm = document.getElementById("username-form");
  const usernameInput = document.getElementById("username-input");
  const usernameError = document.getElementById("username-error");
  const profileName = document.getElementById("profile-name");
  const profileAvatar = document.getElementById("profile-avatar");
  const changeName = document.getElementById("change-name");

  let ws = null;
  let username = localStorage.getItem("chat-username") || "";
  let endpointIndex = 0;
  let joined = false;
  let manuallyClosed = false;
  let retryTimer = null;
  let typingTimer = null;
  const seenMessages = new Set();

  usernameInput.value = username;
  if (!username) modal.classList.remove("hidden");

  function setStatus(text, connected) {
    status.textContent = text;
    statusDot.style.background = connected ? "#4bd6a0" : "#e6b75b";
    input.disabled = !connected || !joined;
    sendButton.disabled = !connected || !joined;
  }

  function initials(name) {
    return Array.from(name || "?")[0].toUpperCase();
  }

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  function connect() {
    clearTimeout(retryTimer);

    if (!urls.length || manuallyClosed) return;

    const base = urls[endpointIndex % urls.length].replace(/\/+$/, "");
    const socketUrl = base.replace(/^http/, "ws") + "/ws";

    setStatus("Connecting...", false);
    serverLabel.textContent = "Connecting";

    try {
      ws = new WebSocket(socketUrl);
    } catch (error) {
      retryNext();
      return;
    }

    ws.onopen = () => {
      setStatus("Connected", true);
      serverLabel.textContent = base;
      if (username) {
        send({ type: "join", username });
      } else {
        modal.classList.remove("hidden");
      }
    };

    ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      if (data.type === "joined") {
        joined = true;
        username = data.username;
        localStorage.setItem("chat-username", username);
        profileName.textContent = username;
        profileAvatar.textContent = initials(username);
        usernameInput.value = username;
        usernameError.textContent = "";
        modal.classList.add("hidden");
        setStatus("Connected", true);
        input.focus();
      }

      if (data.type === "history") {
        messages.replaceChildren();
        seenMessages.clear();
        (data.messages || []).forEach(renderMessage);
      }

      if (data.type === "message") renderMessage(data.message);

      if (data.type === "system") {
        const item = document.createElement("p");
        item.className = "system-message";
        item.textContent = data.text;
        messages.appendChild(item);
        scrollDown();
      }

      if (data.type === "users") renderUsers(data.users || []);

      if (data.type === "typing") {
        if (data.typing) {
          typing.textContent = `${data.username} is typing...`;
          clearTimeout(typingTimer);
          typingTimer = setTimeout(() => typing.textContent = "", 1500);
        } else {
          typing.textContent = "";
        }
      }

      if (data.type === "error") usernameError.textContent = data.text;
    };

    ws.onerror = () => {
      setStatus("Connection issue", false);
    };

    ws.onclose = () => {
      joined = false;
      setStatus("Reconnecting...", false);
      retryNext();
    };
  }

  function retryNext() {
    if (manuallyClosed) return;
    endpointIndex = (endpointIndex + 1) % Math.max(urls.length, 1);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, 1500);
  }

  function scrollDown() {
    messages.scrollTop = messages.scrollHeight;
  }

  function renderMessage(message) {
    if (!message || typeof message.text !== "string" || seenMessages.has(message.id)) {
      return;
    }

    seenMessages.add(message.id);

    const empty = messages.querySelector(".empty");
    if (empty) empty.remove();

    if (message.type === "system") {
      const system = document.createElement("p");
      system.className = "system-message";
      system.textContent = message.text;
      messages.appendChild(system);
      scrollDown();
      return;
    }

    const row = document.createElement("article");
    row.className = "message";

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = initials(message.username);

    const content = document.createElement("div");
    content.className = "message-content";

    const meta = document.createElement("div");
    meta.className = "message-meta";

    const name = document.createElement("span");
    name.className = "message-name";
    name.textContent = message.username || "Guest";

    const time = document.createElement("time");
    time.className = "message-time";
    time.textContent = new Date(message.timestamp * 1000).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });

    const server = document.createElement("span");
    server.className = "message-server";
    server.textContent = message.server || "";

    const text = document.createElement("div");
    text.className = "message-text";
    text.textContent = message.text;

    meta.append(name, time, server);
    content.append(meta, text);
    row.append(avatar, content);
    messages.appendChild(row);
    scrollDown();
  }

  function renderUsers(users) {
    members.replaceChildren();
    memberCount.textContent = String(users.length);

    if (!users.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No users online yet.";
      members.appendChild(empty);
      return;
    }

    users.forEach((user) => {
      const row = document.createElement("div");
      row.className = "member";

      const avatar = document.createElement("div");
      avatar.className = "avatar";
      avatar.textContent = initials(user.username);

      const details = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = user.username;

      const server = document.createElement("small");
      server.textContent = user.server || "Connected";

      details.append(name, server);
      row.append(avatar, details);
      members.appendChild(row);
    });
  }

  usernameForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = usernameInput.value.trim().replace(/\s+/g, " ");

    if (!name) {
      usernameError.textContent = "Please enter a username.";
      return;
    }

    if (name.length > 24) {
      usernameError.textContent = "Usernames must be 24 characters or fewer.";
      return;
    }

    username = name;
    if (ws && ws.readyState === WebSocket.OPEN) {
      send({ type: "join", username });
    } else {
      localStorage.setItem("chat-username", username);
      connect();
    }
  });

  changeName.addEventListener("click", () => {
    usernameInput.value = username;
    usernameError.textContent = "";
    modal.classList.remove("hidden");
    usernameInput.focus();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || !joined) return;

    send({ type: "message", text });
    input.value = "";
    send({ type: "typing", typing: false });
    input.focus();
  });

  input.addEventListener("input", () => {
    send({ type: "typing", typing: input.value.length > 0 });
  });

  window.addEventListener("beforeunload", () => {
    manuallyClosed = true;
    if (ws) ws.close();
  });

  connect();
})();
