import { db } from "./firebase-config.js";
import { state } from "./state.js";
import { initials, escapeHtml, renderBadge } from "./app.js";
import {
  collection, addDoc, doc, updateDoc, onSnapshot, orderBy, query, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const chatEmpty = document.getElementById("chat-empty");
const chatActive = document.getElementById("chat-active");
const messagesEl = document.getElementById("messages");

export function openChat(chatId, peer) {
  if (state.unsubMessages) state.unsubMessages();
  if (state.unsubPeerDoc) state.unsubPeerDoc();

  state.activeChatId = chatId;
  state.activePeer = peer;

  chatEmpty.hidden = true;
  chatActive.hidden = false;
  document.getElementById("peer-name").textContent = peer.displayName;
  document.querySelector(".app-shell")?.classList.add("chat-open");

  document.querySelectorAll(".chat-item").forEach(el => el.classList.remove("active"));

  // Live badge (role/tag) so a ban, promotion, or tag change shows up immediately.
  state.unsubPeerDoc = onSnapshot(doc(db, "users", peer.uid), (snap) => {
    document.getElementById("peer-badge").innerHTML = snap.exists() ? renderBadge(snap.data()) : "";
  });

  const q = query(collection(db, "chats", chatId, "messages"), orderBy("clientTime", "asc"));
  state.unsubMessages = onSnapshot(q, (snap) => {
    messagesEl.innerHTML = "";
    snap.forEach((docSnap) => {
      const m = docSnap.data();
      const mine = m.senderId === state.user.uid;
      const time = m.clientTime ? new Date(m.clientTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
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
    clientTime: Date.now(),   // set immediately — used for sort order and display, no server round-trip
    createdAt: serverTimestamp() // kept for reference, not used for ordering
  });
  await updateDoc(doc(db, "chats", state.activeChatId), { lastMessage: text, lastMessageSenderId: state.user.uid });
});
