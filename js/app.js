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

// ---- sidebar drawer (single-page feel: hidden until opened) ----
const appShell = document.querySelector(".app-shell");
export function openDrawer() { appShell?.classList.add("sidebar-open"); }
export function closeDrawer() { appShell?.classList.remove("sidebar-open"); }
document.getElementById("btn-menu-chat").addEventListener("click", openDrawer);
document.getElementById("btn-menu-empty").addEventListener("click", openDrawer);
document.getElementById("sidebar-backdrop").addEventListener("click", closeDrawer);

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
        if (!state.profile.displayNameLower && state.profile.displayName) {
          const lower = state.profile.displayName.toLowerCase();
          updateDoc(doc(db, "users", user.uid), { displayNameLower: lower }).catch(() => {});
          state.profile.displayNameLower = lower;
        }
      } else {
        // Profile doc never got created (e.g. signup's write failed) — recreate it now.
        await setDoc(doc(db, "users", user.uid), {
          uid: user.uid,
          displayName: state.profile.displayName,
          displayNameLower: state.profile.displayName.toLowerCase(),
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

    document.getElementById("btn-mod-menu").hidden = !(state.profile.role === "owner" || state.profile.role === "admin");

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
let hasAutoOpenedAChat = false;
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
    let firstChat = null;
    snap.forEach((docSnap) => {
      const chat = docSnap.data();
      const peer = chat.participantInfo?.[state.user.uid === chat.participants[0] ? chat.participants[1] : chat.participants[0]];
      if (!peer) return;
      if (!firstChat) firstChat = { id: docSnap.id, peer };
      const item = document.createElement("div");
      item.className = "chat-item" + (state.activeChatId === docSnap.id ? " active" : "");
      item.innerHTML = `
        <div class="chat-avatar">${initials(peer.displayName)}</div>
        <div class="chat-item-meta">
          <div class="chat-item-name">${escapeHtml(peer.displayName)}</div>
          <div class="chat-item-preview">${escapeHtml(chat.lastMessage || "Say hello")}</div>
        </div>`;
      item.addEventListener("click", () => { openChat(docSnap.id, peer); closeDrawer(); });
      list.appendChild(item);
    });

    // Land straight in the conversation instead of the empty/add-friends
    // screen, so opening the app feels like "one page" — only once per
    // session, so it doesn't yank you away from whatever you're doing later.
    if (!hasAutoOpenedAChat && !state.activeChatId && firstChat) {
      hasAutoOpenedAChat = true;
      openChat(firstChat.id, firstChat.peer);
    }
  });
}

export function escapeHtml(str = "") {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// ---- new conversation (inline panel, revealed on demand — no popup) ----
const nameInput = document.getElementById("new-chat-name");
const errEl = document.getElementById("new-chat-error");
const startBtn = document.getElementById("btn-confirm-new-chat");
const emptyPlaceholder = document.getElementById("empty-placeholder");
const newChatPanel = document.getElementById("new-chat-panel");
const matchesEl = document.getElementById("new-chat-matches");

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
  matchesEl.innerHTML = "";
  nameInput.value = "";
  nameInput.focus();
}

// Sidebar's "+ New conversation" — return to the empty screen, panel open.
document.getElementById("btn-new-chat").addEventListener("click", () => {
  goToEmptyScreen();
  showNewChatPanel();
  closeDrawer();
});

// "+ Add friend" on the empty screen itself — just reveal the panel.
document.getElementById("btn-show-new-chat").addEventListener("click", showNewChatPanel);

// Cancel — back to the placeholder.
document.getElementById("btn-cancel-new-chat").addEventListener("click", showPlaceholder);

async function beginChatWith(peer) {
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
  nameInput.value = "";
  matchesEl.innerHTML = "";
  openChat(chatId, peer);
}

async function startConversation() {
  const name = nameInput.value.trim();
  errEl.textContent = "";
  matchesEl.innerHTML = "";
  if (!name) { errEl.textContent = "Enter a display name first."; return; }
  if (name.toLowerCase() === (state.profile.displayNameLower || state.profile.displayName?.toLowerCase())) {
    errEl.textContent = "That's your own name."; return;
  }

  startBtn.disabled = true;
  const originalLabel = startBtn.textContent;
  startBtn.textContent = "Searching…";

  try {
    const usersQ = query(collection(db, "users"), where("displayNameLower", "==", name.toLowerCase()));
    const usersSnap = await getDocs(usersQ);
    const matches = usersSnap.docs.map(d => d.data()).filter(u => u.uid !== state.user.uid);

    if (matches.length === 0) { errEl.textContent = "No vox account with that display name."; return; }

    if (matches.length === 1) {
      await beginChatWith(matches[0]);
      return;
    }

    // More than one account shares this name — let the user pick the right one.
    errEl.textContent = "";
    matches.forEach((peer) => {
      const row = document.createElement("div");
      row.className = "match-row";
      row.innerHTML = `
        <div class="chat-avatar">${initials(peer.displayName)}</div>
        <div>
          <div class="n">${escapeHtml(peer.displayName)}</div>
          <div class="e">${escapeHtml(peer.email || "")}</div>
        </div>`;
      row.addEventListener("click", () => beginChatWith(peer));
      matchesEl.appendChild(row);
    });
  } catch (err) {
    console.error("startConversation failed:", err);
    errEl.textContent = "Something went wrong — check the console for details.";
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = originalLabel;
  }
}

startBtn.addEventListener("click", startConversation);
nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") startConversation(); });
