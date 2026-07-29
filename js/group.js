import { db, storage } from "./firebase-config.js";
import { state } from "./state.js";
import { initials, escapeHtml, renderBadge, closeDrawer } from "./app.js";
import { showToast } from "./toast.js";
import {
  doc, updateDoc, deleteDoc, getDocs, collection
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// ---------------- group info panel ----------------
const screenGroupInfo = document.getElementById("screen-group-info");

document.getElementById("btn-peer-info")?.addEventListener("click", () => {
  if (!state.activePeer?.isGroup) return;
  closeDrawer();
  openGroupInfo();
});

function openGroupInfo() {
  const peer = state.activePeer;
  if (!peer?.isGroup) return;

  document.getElementById("group-info-name").textContent = peer.displayName;
  const iconEl = document.getElementById("group-info-icon");
  iconEl.innerHTML = peer.groupIcon ? `<img src="${peer.groupIcon}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" />` : "";
  iconEl.classList.toggle("chat-avatar-blank", !peer.groupIcon);

  const listEl = document.getElementById("group-info-members");
  const memberUids = Object.keys(peer.participantInfo || {});
  listEl.innerHTML = memberUids.map((uid) => {
    const info = state.userCache[uid] || peer.participantInfo[uid] || {};
    return `
      <div class="mod-row" style="grid-template-columns: 34px 1fr;">
        <div class="chat-avatar">${initials(info.displayName)}</div>
        <div class="mod-row-name">
          <div class="n">${escapeHtml(info.displayName || "—")}${uid === state.user.uid ? " (you)" : ""} ${renderBadge(info)}</div>
          <div class="e">${escapeHtml(info.email || "")}</div>
        </div>
      </div>`;
  }).join("");

  const deleteBtn = document.getElementById("btn-delete-group");
  const canDelete = ["owner", "co-owner", "admin"].includes(state.profile?.role);
  deleteBtn.hidden = !canDelete;

  screenGroupInfo.hidden = false;
  screenGroupInfo.classList.add("active");
}

document.getElementById("btn-close-group-info")?.addEventListener("click", () => {
  screenGroupInfo.hidden = true;
  screenGroupInfo.classList.remove("active");
});

document.getElementById("btn-change-group-icon")?.addEventListener("click", () => {
  document.getElementById("group-icon-input").click();
});

document.getElementById("group-icon-input")?.addEventListener("change", async () => {
  const input = document.getElementById("group-icon-input");
  const file = input.files?.[0];
  input.value = "";
  if (!file || !state.activeChatId) return;
  try {
    const fileRef = ref(storage, `group-icons/${state.activeChatId}`);
    await uploadBytes(fileRef, file);
    const url = await getDownloadURL(fileRef);
    await updateDoc(doc(db, "chats", state.activeChatId), { groupIcon: url });
    state.activePeer.groupIcon = url;
    showToast("Group icon updated.", false);
    openGroupInfo();
  } catch (err) {
    console.error("Group icon upload failed:", err);
    showToast(`Couldn't update icon: ${err.code || err.message || "unknown error"}`);
  }
});

document.getElementById("btn-delete-group")?.addEventListener("click", async () => {
  if (!state.activeChatId) return;
  if (!confirm(`Delete "${state.activePeer.displayName}" for everyone? This can't be undone.`)) return;
  try {
    const msgsSnap = await getDocs(collection(db, "chats", state.activeChatId, "messages"));
    await Promise.all(msgsSnap.docs.map(d => deleteDoc(d.ref)));
    await deleteDoc(doc(db, "chats", state.activeChatId));
    screenGroupInfo.hidden = true;
    screenGroupInfo.classList.remove("active");
    showToast("Group deleted.", false);
  } catch (err) {
    console.error("Group delete failed:", err);
    showToast(`Couldn't delete group: ${err.code || err.message || "unknown error"}`);
  }
});

// ---------------- my profile icon ----------------
const screenProfile = document.getElementById("screen-profile");

document.getElementById("btn-my-profile")?.addEventListener("click", () => {
  closeDrawer();
  const iconEl = document.getElementById("profile-icon");
  if (state.profile?.photoURL) {
    iconEl.innerHTML = `<img src="${state.profile.photoURL}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" />`;
  } else {
    iconEl.innerHTML = initials(state.profile?.displayName);
  }
  screenProfile.hidden = false;
  screenProfile.classList.add("active");
});

document.getElementById("btn-close-profile")?.addEventListener("click", () => {
  screenProfile.hidden = true;
  screenProfile.classList.remove("active");
});

document.getElementById("btn-change-profile-icon")?.addEventListener("click", () => {
  document.getElementById("profile-icon-input").click();
});

document.getElementById("profile-icon-input")?.addEventListener("change", async () => {
  const input = document.getElementById("profile-icon-input");
  const file = input.files?.[0];
  input.value = "";
  if (!file || !state.user) return;
  try {
    const fileRef = ref(storage, `profile-icons/${state.user.uid}`);
    await uploadBytes(fileRef, file);
    const url = await getDownloadURL(fileRef);
    await updateDoc(doc(db, "users", state.user.uid), { photoURL: url });
    state.profile.photoURL = url;
    showToast("Profile icon updated.", false);
    document.getElementById("profile-icon").innerHTML = `<img src="${url}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" />`;
  } catch (err) {
    console.error("Profile icon upload failed:", err);
    showToast(`Couldn't update icon: ${err.code || err.message || "unknown error"}`);
  }
});
