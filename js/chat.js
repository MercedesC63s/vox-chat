import { db, storage } from "./firebase-config.js";
import { state } from "./state.js";
import { initials, escapeHtml, renderBadge } from "./app.js";
import { showToast } from "./toast.js";
import {
  collection, addDoc, doc, updateDoc, onSnapshot, orderBy, query, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

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
        let senderLabel = "";
        if (!mine && peer.isGroup) {
          const senderName = peer.participantInfo?.[m.senderId]?.displayName;
          if (senderName) senderLabel = `<span class="msg-sender">${escapeHtml(senderName)}</span>`;
        }
        let mediaHtml = "";
        if (m.mediaUrl && m.mediaType === "image") {
          mediaHtml = `<img class="msg-media" src="${m.mediaUrl}" alt="image" />`;
        } else if (m.mediaUrl && m.mediaType === "video") {
          mediaHtml = `<video class="msg-media" src="${m.mediaUrl}" controls></video>`;
        }
        bubble.innerHTML = `${senderLabel}${mediaHtml}${m.text ? escapeHtml(m.text) : ""}<span class="msg-time">${time}</span>`;
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

// ---------------- + attach menu ----------------
const attachMenu = document.getElementById("attach-menu");
const emojiPicker = document.getElementById("emoji-picker");

document.getElementById("btn-attach")?.addEventListener("click", (e) => {
  e.stopPropagation();
  attachMenu.hidden = !attachMenu.hidden;
  emojiPicker.hidden = true;
});
document.addEventListener("click", (e) => {
  if (!attachMenu.hidden && !attachMenu.contains(e.target) && e.target.id !== "btn-attach") attachMenu.hidden = true;
  if (!emojiPicker.hidden && !emojiPicker.contains(e.target) && e.target.id !== "btn-attach-emoji") emojiPicker.hidden = true;
});

// ---------------- emoji ----------------
const EMOJI_SET = [
  "😀","😂","😍","😊","😉","😎","🤔","😴","😢","😭","😡","🥳","😱","🙄","😇","🤗",
  "👍","👎","👏","🙏","🙌","💪","🤝","👋","🔥","✨","🎉","💯","❤️","💔","💀","👀",
  "🐶","🐱","🍕","🍔","☕","🍺","⚽","🏀","🎮","🎵","📷","🚀","☀️","🌙","⭐","🌧️"
];
let emojiBuilt = false;
document.getElementById("btn-attach-emoji")?.addEventListener("click", (e) => {
  e.stopPropagation();
  attachMenu.hidden = true;
  if (!emojiBuilt) {
    emojiPicker.innerHTML = EMOJI_SET.map(em => `<button type="button" class="emoji-btn">${em}</button>`).join("");
    emojiPicker.querySelectorAll(".emoji-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const input = document.getElementById("message-input");
        input.value += btn.textContent;
        input.focus();
      });
    });
    emojiBuilt = true;
  }
  emojiPicker.hidden = !emojiPicker.hidden;
});

// ---------------- image / video upload ----------------
const mediaInput = document.getElementById("media-input");
document.getElementById("btn-attach-media")?.addEventListener("click", (e) => {
  e.stopPropagation();
  attachMenu.hidden = true;
  mediaInput.click();
});

mediaInput?.addEventListener("change", async () => {
  const file = mediaInput.files?.[0];
  mediaInput.value = "";
  if (!file || !state.activeChatId) return;

  const mediaType = file.type.startsWith("video") ? "video" : "image";
  const MAX_MB = 25;
  if (file.size > MAX_MB * 1024 * 1024) {
    showToast(`File's too big — keep it under ${MAX_MB}MB.`);
    return;
  }

  showToast(`Uploading ${mediaType}…`, false);
  try {
    const path = `chat-media/${state.activeChatId}/${Date.now()}_${file.name}`;
    const fileRef = ref(storage, path);
    await uploadBytes(fileRef, file);
    const url = await getDownloadURL(fileRef);

    await addDoc(collection(db, "chats", state.activeChatId, "messages"), {
      text: "",
      mediaUrl: url,
      mediaType,
      senderId: state.user.uid,
      clientTime: Date.now(),
      createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, "chats", state.activeChatId), {
      lastMessage: mediaType === "image" ? "📷 Image" : "🎥 Video",
      lastMessageSenderId: state.user.uid
    });
  } catch (err) {
    console.error("Media upload failed:", err);
    showToast(`Upload failed: ${err.code || err.message || "unknown error"}`);
  }
});
