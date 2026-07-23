import { auth, db } from "./firebase-config.js";
import { state } from "./state.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, setDoc, getDoc, updateDoc, collection, query, where,
  onSnapshot, serverTimestamp, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { openChat } from "./chat.js";
import { listenForIncomingCalls } from "./call.js";

const screenAuth = document.getElementById("screen-auth");
const screenApp = document.getElementById("screen-app");

export function initials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join("");
}

onAuthStateChanged(auth, async (user) => {
  if (user) {
    state.user = user;
    const snap = await getDoc(doc(db, "users", user.uid));
    state.profile = snap.exists() ? snap.data() : { uid: user.uid, displayName: user.displayName, email: user.email };
    document.getElementById("me-name").textContent = state.profile.displayName || "you";
    await updateDoc(doc(db, "users", user.uid), { status: "online" }).catch(() => {});
    screenAuth.classList.remove("active");
    screenApp.classList.add("active");
    listenToChats();
    listenForIncomingCalls();
  } else {
    state.user = null;
    state.profile = null;
    screenApp.classList.remove("active");
    screenAuth.classList.add("active");
  }
});

// ---- chat list ----
function listenToChats() {
  const q = query(collection(db, "chats"), where("participants", "array-contains", state.user.uid));
  onSnapshot(q, (snap) => {
    const list = document.getElementById("chat-list");
    list.innerHTML = "";
    snap.forEach((docSnap) => {
      const chat = docSnap.data();
      const peer = chat.participantInfo?.[state.user.uid === chat.participants[0] ? chat.participants[1] : chat.participants[0]];
      if (!peer) return;
      const item = document.createElement("div");
      item.className = "chat-item" + (state.activeChatId === docSnap.id ? " active" : "");
      item.innerHTML = `
        <div class="chat-avatar">${initials(peer.displayName)}</div>
        <div class="chat-item-meta">
          <div class="chat-item-name">${escapeHtml(peer.displayName)}</div>
          <div class="chat-item-preview">${escapeHtml(chat.lastMessage || "Say hello")}</div>
        </div>`;
      item.addEventListener("click", () => openChat(docSnap.id, peer));
      list.appendChild(item);
    });
  });
}

export function escapeHtml(str = "") {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// ---- new conversation modal ----
const modal = document.getElementById("modal-new-chat");
document.getElementById("btn-new-chat").addEventListener("click", () => {
  document.getElementById("new-chat-email").value = "";
  document.getElementById("new-chat-error").textContent = "";
  modal.hidden = false;
});
document.getElementById("btn-cancel-new-chat").addEventListener("click", () => modal.hidden = true);

document.getElementById("btn-confirm-new-chat").addEventListener("click", async () => {
  const email = document.getElementById("new-chat-email").value.trim().toLowerCase();
  const errEl = document.getElementById("new-chat-error");
  errEl.textContent = "";
  if (!email) return;
  if (email === state.profile.email) { errEl.textContent = "That's your own email."; return; }

  const usersQ = query(collection(db, "users"), where("email", "==", email));
  const usersSnap = await getDocs(usersQ);
  if (usersSnap.empty) { errEl.textContent = "No vox account with that email."; return; }

  const peerDoc = usersSnap.docs[0];
  const peer = peerDoc.data();
  const chatId = [state.user.uid, peer.uid].sort().join("_");
  const chatRef = doc(db, "chats", chatId);
  const existing = await getDoc(chatRef);
  if (!existing.exists()) {
    await setDoc(chatRef, {
      participants: [state.user.uid, peer.uid],
      participantInfo: {
        [state.user.uid]: { displayName: state.profile.displayName, email: state.profile.email },
        [peer.uid]: { displayName: peer.displayName, email: peer.email }
      },
      createdAt: serverTimestamp(),
      lastMessage: ""
    });
  }
  modal.hidden = true;
  openChat(chatId, peer);
});

