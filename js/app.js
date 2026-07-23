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

    // Load (or self-heal) the profile doc. A Firestore hiccup here should
    // never trap the user on the login screen — fall back to what we
    // already know from the auth account itself.
    state.profile = { uid: user.uid, displayName: user.displayName || "you", email: (user.email || "").toLowerCase() };
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) {
        state.profile = snap.data();
      } else {
        // Profile doc never got created (e.g. signup's write failed) — recreate it now.
        await setDoc(doc(db, "users", user.uid), {
          uid: user.uid,
          displayName: state.profile.displayName,
          email: state.profile.email,
          createdAt: serverTimestamp(),
          status: "online"
        });
      }
    } catch (err) {
      console.error("Could not load/create profile doc — check that Firestore rules are published:", err);
    }

    document.getElementById("me-name").textContent = state.profile.displayName || "you";
    updateDoc(doc(db, "users", user.uid), { status: "online" }).catch((err) => console.error("status update failed:", err));

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

// ---- new conversation (inline panel, no popup) ----
const emailInput = document.getElementById("new-chat-email");
const errEl = document.getElementById("new-chat-error");
const startBtn = document.getElementById("btn-confirm-new-chat");

// "+ New conversation" just returns you to the empty/panel view,
// even if a chat is currently open.
document.getElementById("btn-new-chat").addEventListener("click", () => {
  if (state.unsubMessages) { state.unsubMessages(); state.unsubMessages = null; }
  state.activeChatId = null;
  state.activePeer = null;
  document.getElementById("chat-active").hidden = true;
  document.getElementById("chat-empty").hidden = false;
  document.querySelector(".app-shell")?.classList.remove("chat-open");
  document.querySelectorAll(".chat-item").forEach(el => el.classList.remove("active"));
  errEl.textContent = "";
  emailInput.value = "";
  emailInput.focus();
});

async function startConversation() {
  const email = emailInput.value.trim().toLowerCase();
  errEl.textContent = "";
  if (!email) { errEl.textContent = "Enter an email first."; return; }
  if (email === state.profile.email) { errEl.textContent = "That's your own email."; return; }

  startBtn.disabled = true;
  const originalLabel = startBtn.textContent;
  startBtn.textContent = "Starting…";

  try {
    const usersQ = query(collection(db, "users"), where("email", "==", email));
    const usersSnap = await getDocs(usersQ);
    if (usersSnap.empty) { errEl.textContent = "No vox account with that email."; return; }

    const peer = usersSnap.docs[0].data();
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
    emailInput.value = "";
    openChat(chatId, peer);
  } catch (err) {
    console.error("startConversation failed:", err);
    errEl.textContent = "Something went wrong — check the console for details.";
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = originalLabel;
  }
}

startBtn.addEventListener("click", startConversation);
emailInput.addEventListener("keydown", (e) => { if (e.key === "Enter") startConversation(); });
