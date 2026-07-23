import { db } from "./firebase-config.js";
import { state } from "./state.js";
import { initials, escapeHtml } from "./app.js";
import {
  collection, addDoc, doc, updateDoc, onSnapshot, orderBy, query, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const chatEmpty = document.getElementById("chat-empty");
const chatActive = document.getElementById("chat-active");
const messagesEl = document.getElementById("messages");

export function openChat(chatId, peer) {
  if (state.unsubMessages) state.unsubMessages();

  state.activeChatId = chatId;
  state.activePeer = peer;

  chatEmpty.hidden = true;
  chatActive.hidden = false;
  document.getElementById("peer-name").textContent = peer.displayName;
  document.querySelector(".app-shell")?.classList.add("chat-open");

  document.querySelectorAll(".chat-item").forEach(el => el.classList.remove("active"));

  const q = query(collection(db, "chats", chatId, "messages"), orderBy("createdAt", "asc"));
  state.unsubMessages = onSnapshot(q, (snap) => {
    messagesEl.innerHTML = "";
    snap.forEach((docSnap) => {
      const m = docSnap.data();
      const mine = m.senderId === state.user.uid;
      const time = m.createdAt?.toDate ? m.createdAt.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
      const bubble = document.createElement("div");
      bubble.className = "msg " + (mine ? "msg-mine" : "msg-theirs");
      bubble.innerHTML = `${escapeHtml(m.text)}<span class="msg-time">${time}</span>`;
      messagesEl.appendChild(bubble);
    });
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

document.getElementById("form-message").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.activeChatId) return;
  const input = document.getElementById("message-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";

  await addDoc(collection(db, "chats", state.activeChatId, "messages"), {
    text,
    senderId: state.user.uid,
    createdAt: serverTimestamp()
  });
  await updateDoc(doc(db, "chats", state.activeChatId), { lastMessage: text });
});
