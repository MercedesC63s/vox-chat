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
import { pauseScreenShareForPrivacy, resumeScreenShareIfPaused } from "./call.js";

const chatEmpty = document.getElementById("chat-empty");
const chatActive = document.getElementById("chat-active");
const messagesEl = document.getElementById("messages");

export function openChat(chatId, peer) {
  if (state.unsubMessages) state.unsubMessages();
  if (state.unsubPeerDoc) state.unsubPeerDoc();
  if (state.unsubChatDoc) state.unsubChatDoc();

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

  // Typing indicator — watches the chat doc's `typing` map for anyone else's flag.
  const typingEl = document.getElementById("typing-indicator");
  state.unsubChatDoc = onSnapshot(doc(db, "chats", chatId), (snap) => {
    const typing = snap.data()?.typing || {};
    const othersTyping = Object.entries(typing)
      .filter(([uid, isTyping]) => uid !== state.user.uid && isTyping)
      .map(([uid]) => peer.participantInfo?.[uid]?.displayName)
      .filter(Boolean);
    if (othersTyping.length === 0) {
      typingEl.hidden = true;
    } else {
      typingEl.hidden = false;
      typingEl.textContent = peer.isGroup
        ? `${othersTyping.join(", ")} typing…`
        : "typing…";
    }
  }, (err) => console.error("Typing listener failed:", err));

  const q = query(collection(db, "chats", chatId, "messages"), orderBy("clientTime", "asc"));
  state.unsubMessages = onSnapshot(q,
    (snap) => {
      messagesEl.innerHTML = "";
      snap.forEach((docSnap) => {
        const m = docSnap.data();
        const messageId = docSnap.id;
        const mine = m.senderId === state.user.uid;
        const time = m.clientTime ? new Date(m.clientTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
        const bubble = document.createElement("div");
        bubble.className = "msg " + (mine ? "msg-mine" : "msg-theirs");
        bubble.dataset.msgId = messageId;

        let senderLabel = "";
        if (!mine && peer.isGroup) {
          const senderName = peer.participantInfo?.[m.senderId]?.displayName;
          if (senderName) senderLabel = `<span class="msg-sender">${escapeHtml(senderName)}</span>`;
        }

        let bodyHtml;
        if (m.deleted) {
          bodyHtml = `<em class="msg-deleted">Message deleted</em>`;
        } else {
          let mediaHtml = "";
          if (m.mediaUrl && m.mediaType === "image") mediaHtml = `<img class="msg-media" src="${m.mediaUrl}" alt="image" />`;
          else if (m.mediaUrl && m.mediaType === "video") mediaHtml = `<video class="msg-media" src="${m.mediaUrl}" controls></video>`;
          bodyHtml = `<span class="msg-text">${mediaHtml}${m.text ? escapeHtml(m.text) : ""}</span>`;
        }

        const editedTag = (m.edited && !m.deleted) ? `<span class="msg-edited">(edited)</span>` : "";

        let reactionsHtml = "";
        if (m.reactions && Object.keys(m.reactions).length) {
          const counts = {};
          Object.values(m.reactions).forEach(em => { counts[em] = (counts[em] || 0) + 1; });
          reactionsHtml = `<div class="msg-reactions">` + Object.entries(counts).map(([em, count]) => {
            const isMine = m.reactions[state.user.uid] === em;
            return `<button type="button" class="msg-reaction-pill${isMine ? " mine" : ""}" data-emoji="${em}">${em} ${count}</button>`;
          }).join("") + `</div>`;
        }

        let actionsHtml = "";
        if (!m.deleted) {
          actionsHtml = `<div class="msg-actions">
            <button type="button" class="msg-action-btn" data-action="react" title="React">🙂</button>
            ${mine ? `<button type="button" class="msg-action-btn" data-action="edit" title="Edit">✎</button>` : ""}
            ${mine ? `<button type="button" class="msg-action-btn" data-action="delete" title="Delete">🗑</button>` : ""}
          </div>`;
        }

        bubble.innerHTML = `${senderLabel}${bodyHtml}${editedTag}<span class="msg-time">${time}</span>${reactionsHtml}${actionsHtml}`;
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
  setTyping(false);

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

document.getElementById("btn-game-hexagone")?.addEventListener("click", (e) => {
  e.stopPropagation();
  attachMenu.hidden = true;
  window.open("https://apac2324.github.io/Hex-A-Gone/", "_blank", "noopener");
});
document.getElementById("btn-game-truthordare")?.addEventListener("click", (e) => {
  e.stopPropagation();
  attachMenu.hidden = true;
  window.open("https://apac2324.github.io/Truth-or-dare-don-t-be-scared/", "_blank", "noopener");
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

// ---------------- secret blackout while texting ----------------
// If you're screen-sharing on a call and start typing here, the person
// watching your screen sees it go black (your own view is unaffected) —
// resumes automatically once you stop typing / leave the input.
const msgInputForPrivacy = document.getElementById("message-input");
let privacyResumeTimer = null;

msgInputForPrivacy?.addEventListener("focus", () => {
  clearTimeout(privacyResumeTimer);
  pauseScreenShareForPrivacy();
});
msgInputForPrivacy?.addEventListener("input", () => {
  clearTimeout(privacyResumeTimer);
  pauseScreenShareForPrivacy();
});
msgInputForPrivacy?.addEventListener("blur", () => {
  // Small delay so clicking the send button (which blurs the input first)
  // doesn't cause a flicker of resuming right before the message sends.
  privacyResumeTimer = setTimeout(resumeScreenShareIfPaused, 600);
});

// ---------------- typing indicator ----------------
let isCurrentlyTyping = false;
let typingClearTimer = null;

function setTyping(isTyping) {
  if (!state.activeChatId) return;
  if (isTyping === isCurrentlyTyping) return;
  isCurrentlyTyping = isTyping;
  updateDoc(doc(db, "chats", state.activeChatId), { [`typing.${state.user.uid}`]: isTyping }).catch(() => {});
}

document.getElementById("message-input")?.addEventListener("input", () => {
  setTyping(true);
  clearTimeout(typingClearTimer);
  typingClearTimer = setTimeout(() => setTyping(false), 3000);
});
document.getElementById("message-input")?.addEventListener("blur", () => {
  clearTimeout(typingClearTimer);
  setTyping(false);
});

// ---------------- message actions: react / edit / delete ----------------
const reactionPicker = document.getElementById("reaction-picker");
const REACTION_SET = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
let reactionTargetMsgId = null;
let reactionBuilt = false;

function buildReactionPicker() {
  if (reactionBuilt) return;
  reactionPicker.innerHTML = REACTION_SET.map(em => `<button type="button" class="emoji-btn">${em}</button>`).join("");
  reactionPicker.querySelectorAll(".emoji-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!reactionTargetMsgId || !state.activeChatId) return;
      reactionPicker.hidden = true;
      const msgRef = doc(db, "chats", state.activeChatId, "messages", reactionTargetMsgId);
      try {
        await updateDoc(msgRef, { [`reactions.${state.user.uid}`]: btn.textContent });
      } catch (err) {
        console.error("Reaction failed:", err);
        showToast(`Reaction didn't save: ${err.code || err.message || "unknown error"}`);
      }
    });
  });
  reactionBuilt = true;
}

messagesEl.addEventListener("click", async (e) => {
  const bubble = e.target.closest(".msg");
  if (!bubble) return;
  const msgId = bubble.dataset.msgId;
  if (!msgId || !state.activeChatId) return;
  const msgRef = doc(db, "chats", state.activeChatId, "messages", msgId);

  // Clicking an existing reaction pill: toggle it off if it's yours, otherwise switch to it.
  const pill = e.target.closest(".msg-reaction-pill");
  if (pill) {
    try {
      if (pill.classList.contains("mine")) {
        await updateDoc(msgRef, { [`reactions.${state.user.uid}`]: null });
      } else {
        await updateDoc(msgRef, { [`reactions.${state.user.uid}`]: pill.dataset.emoji });
      }
    } catch (err) {
      console.error("Reaction toggle failed:", err);
    }
    return;
  }

  const actionBtn = e.target.closest(".msg-action-btn");
  if (!actionBtn) return;
  const action = actionBtn.dataset.action;

  if (action === "react") {
    buildReactionPicker();
    reactionTargetMsgId = msgId;
    reactionPicker.hidden = !reactionPicker.hidden;
    return;
  }

  if (action === "delete") {
    if (!confirm("Delete this message?")) return;
    try {
      await updateDoc(msgRef, { deleted: true, text: "" });
    } catch (err) {
      console.error("Delete failed:", err);
      showToast(`Couldn't delete: ${err.code || err.message || "unknown error"}`);
    }
    return;
  }

  if (action === "edit") {
    const textEl = bubble.querySelector(".msg-text");
    const currentText = textEl ? textEl.textContent : "";
    bubble.innerHTML = `
      <div class="msg-edit-row">
        <input type="text" class="msg-edit-input" value="${escapeHtml(currentText)}" />
        <button type="button" class="btn-ghost msg-edit-save">Save</button>
        <button type="button" class="btn-ghost msg-edit-cancel">Cancel</button>
      </div>`;
    const editInput = bubble.querySelector(".msg-edit-input");
    editInput.focus();
    editInput.setSelectionRange(currentText.length, currentText.length);

    const save = async () => {
      const newText = editInput.value.trim();
      if (!newText) return;
      try {
        await updateDoc(msgRef, { text: newText, edited: true });
      } catch (err) {
        console.error("Edit failed:", err);
        showToast(`Couldn't save edit: ${err.code || err.message || "unknown error"}`);
      }
    };
    bubble.querySelector(".msg-edit-save").addEventListener("click", save);
    editInput.addEventListener("keydown", (ev) => { if (ev.key === "Enter") save(); });
    bubble.querySelector(".msg-edit-cancel").addEventListener("click", () => {
      // Listener will re-render this bubble back to normal on the next
      // snapshot anyway, but re-triggering isn't guaranteed instantly —
      // easiest reliable fix is to just leave editing mode by re-running
      // the render for this one message from current Firestore state.
      onSnapshotForceRerender();
    });
  }
});

document.addEventListener("click", (e) => {
  if (!reactionPicker.hidden && !reactionPicker.contains(e.target) && !e.target.closest('[data-action="react"]')) {
    reactionPicker.hidden = true;
  }
});

// Cancel-edit fallback: nudges the messages listener by touching nothing —
// since Firestore listeners don't replay on demand, simplest reliable
// approach is to just reload this chat's view from state.
function onSnapshotForceRerender() {
  if (state.activeChatId && state.activePeer) openChat(state.activeChatId, state.activePeer);
}
