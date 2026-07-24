import { auth, db } from "./firebase-config.js";
import { state } from "./state.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, setDoc, getDoc, updateDoc, collection, query, where,
  onSnapshot, serverTimestamp, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { openChat } from "./chat.js";
import { listenForIncomingCalls } from "./call.js";
import { requestNotificationPermission, notify } from "./notifications.js";

const screenAuth = document.getElementById("screen-auth");
const screenApp = document.getElementById("screen-app");

// YOUR ACCOUNT EMAIL - CHANGE THIS TO RESTRICT MOD MENU TO ONLY YOU
const MOD_ONLY_EMAIL = "oliver.furina@marymede.vic.edu.au";

export function initials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join("");
}

// Renders role + custom tag as small badges. Used in the sidebar,
// chat header, and mod menu so they all stay visually consistent.
export function renderBadge(profile) {
  if (!profile) return "";
  let html = "";
  if (profile.role === "owner") html += `<span class="badge badge-owner">owner</span>`;
  else if (profile.role === "admin") html += `<span class="badge badge-admin">admin</span>`;
  if (profile.tag) html += `<span class="badge badge-tag">${escapeHtml(profile.tag)}</span>`;
  return html;
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
          status: "online",
          role: "member",
          tag: "",
          banned: false
        });
      }
    } catch (err) {
      console.error("Could not load/create profile doc — check that Firestore rules are published:", err);
    }

    document.getElementById("me-name").textContent = state.profile.displayName || "you";
    document.getElementById("me-badge").innerHTML = renderBadge(state.profile);

    if (state.profile.banned) {
      screenAuth.classList.remove("active");
      screenApp.classList.remove("active");
      document.getElementById("screen-banned").classList.add("active");
      return;
    }
    document.getElementById("screen-banned").classList.remove("active");

    // Restrict mod menu to specific email only
    const isModRestricted = state.profile.email === MOD_ONLY_EMAIL && (state.profile.role === "owner" || state.profile.role === "admin");
    document.getElementById("btn-mod-menu").hidden = !isModRestricted;

    updateDoc(doc(db, "users", user.uid), { status: "online" }).catch((err) => console.error("status update failed:", err));

    screenAuth.classList.remove("active");
    screenApp.classList.add("active");
    listenToChats();
    listenForIncomingCalls();
    requestNotificationPermission();
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
    // Firestore reports every doc as "added" on first attach, and "modified"
    // on real later changes — so filtering on "modified" here naturally
    // means we only ever notify for genuinely new incoming messages,
    // never for the chat history loading in.
    snap.docChanges().forEach((change) => {
      if (change.type !== "modified") return;
      const chat = change.doc.data();
      if (!chat.lastMessageSenderId || chat.lastMessageSenderId === state.user.uid) return;
      const isOpenAndFocused = state.activeChatId === change.doc.id && document.hasFocus();
      if (isOpenAndFocused) return;
      const peer = chat.participantInfo?.[chat.lastMessageSenderId];
      notify(peer?.displayName || "New message", chat.lastMessage || "");
    });

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

// ---- new conversation (inline panel, revealed on demand — no popup) ----
const emailInput = document.getElementById("new-chat-email");
const errEl = document.getElementById("new-chat-error");
const startBtn = document.getElementById("btn-confirm-new-chat");
const emptyPlaceholder = document.getElementById("empty-placeholder");
const newChatPanel = document.getElementById("new-chat-panel");

function goToEmptyScreen() {
  if (state.unsubMessages) { state.unsubMessages(); state.unsubMessages = null; }
  if (state.unsubPeerDoc) { state.unsubPeerDoc(); state.unsubPeerDoc = null; }
  state.activeChatId = null;
  state.activePeer = null;
  document.getElementById("chat-active").hidden = true;
  document.getElementById("chat-empty").hidden = false;
  document.querySelector(".app-shell")?.classList.remove("chat-open");
  document.querySelectorAll(".chat-item").forEach(el => el.classList.remove("active"));
  showPlaceholder();
}

function showPlaceholder() {
  newChatPanel.hidden = true;
  emptyPlaceholder.hidden = false;
}

function showNewChatPanel() {
  emptyPlaceholder.hidden = true;
  newChatPanel.hidden = false;
  errEl.textContent = "";
  emailInput.value = "";
  emailInput.focus();
}

// Sidebar's "+ New conversation" — return to the empty screen, panel open.
document.getElementById("btn-new-chat").addEventListener("click", () => {
  goToEmptyScreen();
  showNewChatPanel();
});

// "+ Add friend" on the empty screen itself — just reveal the panel.
document.getElementById("btn-show-new-chat").addEventListener("click", showNewChatPanel);

// Cancel — back to the placeholder.
document.getElementById("btn-cancel-new-chat").addEventListener("click", showPlaceholder);

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
