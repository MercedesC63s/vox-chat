import { db } from "./firebase-config.js";
import { state } from "./state.js";
import { initials, escapeHtml, renderBadge } from "./app.js";
import { showToast } from "./toast.js";
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
  // Guarded: this must never be able to block the messages listener below.
  if (peer.uid) {
    state.unsubPeerDoc = onSnapshot(doc(db, "users", peer.uid), (snap) => {
      document.getElementById("peer-badge").innerHTML = snap.exists() ? renderBadge(snap.data()) : "";
    }, (err) => console.error("Peer badge listener failed:", err));
  } else {
    console.error("openChat called without peer.uid — badge won't update live, but messages will still load.");
  }

  const q = query(collection(db, "chats", chatId, "messages"), orderBy("clientTime", "asc"));
  state.unsubMessages = onSnapshot(q,
    (snap) => {
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
    },
    (err) => {
      console.error("Messages listener failed:", err);
      showToast(`Can't load messages: ${err.code || err.message || "unknown error"}`);
    }
  );
}

document.getElementById("form-message").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.activeChatId) return;
  const input = document.getElementById("message-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";

  try {
    await addDoc(collection(db, "chats", state.activeChatId, "messages"), {
      text,
      senderId: state.user.uid,
      clientTime: Date.now(),   // set immediately — used for sort order and display, no server round-trip
      createdAt: serverTimestamp() // kept for reference, not used for ordering
    });
    await updateDoc(doc(db, "chats", state.activeChatId), { lastMessage: text, lastMessageSenderId: state.user.uid });
  } catch (err) {
    console.error("Send message failed:", err);
    showToast(`Message didn't send: ${err.code || err.message || "unknown error"}`);
    input.value = text; // give it back so nothing's lost
  }
});
