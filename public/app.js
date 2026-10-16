(() => {
  "use strict";

  const socket = io();

  const elements = {
    connectionStatus: document.getElementById("connection-status"),
    messages: document.getElementById("messages"),
    emptyState: document.getElementById("empty-state"),
    messageForm: document.getElementById("message-form"),
    messageInput: document.getElementById("message-input"),
    sendButton: document.getElementById("send-button"),
    characterCount: document.getElementById("character-count"),
    typingIndicator: document.getElementById("typing-indicator"),
    membersList: document.getElementById("members-list"),
    memberCount: document.getElementById("member-count"),
    profileName: document.getElementById("profile-name"),
    profileAvatar: document.getElementById("profile-avatar"),
    changeNameButton: document.getElementById("change-name-button"),
    usernameModal: document.getElementById("username-modal"),
    usernameForm: document.getElementById("username-form"),
    usernameInput: document.getElementById("username-input"),
    usernameError: document.getElementById("username-error"),
    joinButton: document.getElementById("join-button"),
    toast: document.getElementById("toast")
  };

  const MAX_MESSAGE_LENGTH = 1000;
  const MAX_USERNAME_LENGTH = 24;

  let joined = false;
  let username = "";
  let typingTimer = null;
  let toastTimer = null;
  let typingUsers = new Set();

  const savedUsername = localStorage.getItem("chat-username");

  if (savedUsername) {
    elements.usernameInput.value = savedUsername;
  }

  function initials(name) {
    return Array.from(name.trim())[0]?.toUpperCase() || "G";
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("visible");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      elements.toast.classList.remove("visible");
    }, 3000);
  }

  function setConnectionStatus(text, connected) {
    elements.connectionStatus.textContent = text;

    const dot = document.querySelector(".sidebar-footer .status-dot");

    if (dot) {
      dot.style.background = connected ? "var(--green)" : "var(--danger)";
    }

    elements.messageInput.disabled = !connected || !joined;
    elements.sendButton.disabled = !connected || !joined;
  }

  function updateProfile(name) {
    username = name;

    elements.profileName.textContent = name;
    elements.profileAvatar.textContent = initials(name);

    localStorage.setItem("chat-username", name);
  }

  function joinChat(requestedName) {
    const cleanName = requestedName.trim().replace(/\s+/g, " ");

    if (!cleanName) {
      elements.usernameError.textContent = "Please enter a username.";
      return;
    }

    if (cleanName.length > MAX_USERNAME_LENGTH) {
      elements.usernameError.textContent =
        `Your username must be ${MAX_USERNAME_LENGTH} characters or fewer.`;
      return;
    }

    elements.usernameError.textContent = "";
    elements.joinButton.disabled = true;

    socket.emit("user:join", cleanName, (response) => {
      elements.joinButton.disabled = false;

      if (!response?.ok) {
        elements.usernameError.textContent =
          response?.error || "Unable to join the chat.";
        return;
      }

      joined = true;

      updateProfile(response.username);

      elements.usernameModal.classList.add("hidden");

      setConnectionStatus("Connected", true);
      elements.messageInput.focus();
    });
  }

  elements.usernameForm.addEventListener("submit", (event) => {
    event.preventDefault();
    joinChat(elements.usernameInput.value);
  });

  elements.changeNameButton.addEventListener("click", () => {
    if (joined) {
      socket.disconnect();
      joined = false;
    }

    elements.usernameInput.value = username;
    elements.usernameModal.classList.remove("hidden");
    elements.usernameError.textContent = "";
    elements.usernameInput.focus();
  });

  function formatTime(timestamp) {
    const date = new Date(timestamp);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function scrollToLatest() {
    elements.messages.scrollTop = elements.messages.scrollHeight;
  }

  function renderSystemMessage(message) {
    const item = document.createElement("div");

    item.className = "system-message";
    item.textContent = message.text;

    elements.messages.appendChild(item);
  }

  function renderChatMessage(message) {
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
    name.textContent = message.username;

    const time = document.createElement("time");
    time.className = "message-time";
    time.textContent = formatTime(message.timestamp);
    time.dateTime = message.timestamp;

    const text = document.createElement("div");
    text.className = "message-text";
    text.textContent = message.text;

    meta.append(name, time);
    content.append(meta, text);
    row.append(avatar, content);

    elements.messages.appendChild(row);
  }

  function addMessage(message) {
    if (!message || typeof message.text !== "string") {
      return;
    }

    if (elements.emptyState) {
      elements.emptyState.remove();
      elements.emptyState = null;
    }

    if (message.type === "system") {
      renderSystemMessage(message);
    } else {
      renderChatMessage(message);
    }

    while (elements.messages.children.length > 105) {
      elements.messages.firstElementChild.remove();
    }

    scrollToLatest();
  }

  function loadHistory(messages) {
    elements.messages.replaceChildren();
    elements.emptyState = null;

    if (!Array.isArray(messages) || messages.length === 0) {
      const empty = document.createElement("div");

      empty.className = "empty-state";

      const icon = document.createElement("div");
      icon.className = "empty-icon";
      icon.textContent = "✉";

      const heading = document.createElement("h3");
      heading.textContent = "Your conversation starts here";

      const paragraph = document.createElement("p");
      paragraph.textContent = "Send the first message to get things going.";

      empty.append(icon, heading, paragraph);
      elements.messages.appendChild(empty);

      elements.emptyState = empty;
      return;
    }

    messages.forEach(addMessage);
    scrollToLatest();
  }

  function renderMembers(members) {
    elements.membersList.replaceChildren();

    const safeMembers = Array.isArray(members) ? members : [];

    elements.memberCount.textContent = String(safeMembers.length);

    if (safeMembers.length === 0) {
      const empty = document.createElement("p");

      empty.className = "members-empty";
      empty.textContent = "No one is online yet.";

      elements.membersList.appendChild(empty);
      return;
    }

    safeMembers.forEach((member) => {
      const row = document.createElement("div");
      row.className = "member";

      const avatar = document.createElement("div");
      avatar.className = "avatar";
      avatar.textContent = initials(member.username);

      const details = document.createElement("div");
      details.className = "member-details";

      const name = document.createElement("strong");
      name.textContent = member.username;

      const status = document.createElement("span");
      status.textContent = "● Online";

      details.append(name, status);
      row.append(avatar, details);

      elements.membersList.appendChild(row);
    });
  }

  function updateTypingIndicator() {
    const names = [...typingUsers];

    if (names.length === 0) {
      elements.typingIndicator.textContent = "";
    } else if (names.length === 1) {
      elements.typingIndicator.textContent =
        `${names[0]} is typing...`;
    } else if (names.length === 2) {
      elements.typingIndicator.textContent =
        `${names[0]} and ${names[1]} are typing...`;
    } else {
      elements.typingIndicator.textContent =
        "Several people are typing...";
    }
  }

  function sendTypingStatus(isTyping) {
    if (joined && socket.connected) {
      socket.emit("typing:update", isTyping);
    }
  }

  elements.messageInput.addEventListener("input", () => {
    elements.characterCount.textContent =
      `${elements.messageInput.value.length}/${MAX_MESSAGE_LENGTH}`;

    sendTypingStatus(true);

    clearTimeout(typingTimer);

    typingTimer = setTimeout(() => {
      sendTypingStatus(false);
    }, 900);
  });

  elements.messageForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!joined || !socket.connected) {
      showToast("Please wait for the chat connection.");
      return;
    }

    const message = elements.messageInput.value.trim();

    if (!message) {
      return;
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      showToast("Your message is too long.");
      return;
    }

    socket.emit("message:send", message, (response) => {
      if (!response?.ok) {
        showToast(response?.error || "Message could not be sent.");
        return;
      }

      elements.messageInput.value = "";
      elements.characterCount.textContent = `0/${MAX_MESSAGE_LENGTH}`;

      clearTimeout(typingTimer);
      sendTypingStatus(false);

      elements.messageInput.focus();
    });
  });

  socket.on("connect", () => {
    setConnectionStatus("Connected", true);

    if (joined) {
      socket.emit("user:join", username, (response) => {
        if (response?.ok) {
          updateProfile(response.username);
        }
      });
    }
  });

  socket.on("disconnect", () => {
    setConnectionStatus("Reconnecting", false);
    typingUsers.clear();
    updateTypingIndicator();
  });

  socket.on("connect_error", () => {
    setConnectionStatus("Connection error", false);
  });

  socket.on("history:load", loadHistory);

  socket.on("message:new", addMessage);

  socket.on("users:update", renderMembers);

  socket.on("typing:update", (data) => {
    if (!data || typeof data.username !== "string") {
      return;
    }

    if (data.isTyping) {
      typingUsers.add(data.username);
    } else {
      typingUsers.delete(data.username);
    }

    updateTypingIndicator();
  });

  if (!savedUsername) {
    elements.usernameModal.classList.remove("hidden");
  } else {
    elements.usernameModal.classList.remove("hidden");
  }
})();
