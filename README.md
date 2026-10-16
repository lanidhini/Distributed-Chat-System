# Simple Distributed Chat Website

## Project Overview

This project demonstrates a basic distributed chat application
with two Python servers communicating through WebSockets.

Users can join the chat using a username, exchange text messages,
and see users connected to either server.

## Objectives

- Allow multiple users to communicate in real time.
- Run two independent Python chat servers.
- Forward messages between servers.
- Track online users and their connected servers.
- Preserve message order within each server's outgoing stream.
- Demonstrate basic server failure and reconnection behavior.

## Technologies

- Python
- aiohttp
- WebSockets
- HTML
- CSS
- JavaScript
- TCP/IP
- GitHub

## Project Structure
```text
distributed-chat-system/
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── chat_server.py
├── server1.py
├── server2.py
├── requirements.txt
├── .gitignore
└── README.md
