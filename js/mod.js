import { db } from "./firebase-config.js";
import { state } from "./state.js";
import { initials, escapeHtml, renderBadge } from "./app.js";
import {
  collection, query, onSnapshot, updateDoc, doc, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const modScreen = document.getElementById("screen-mod");
const modUserList = document.getElementById("mod-user-list");

export function openModMenu() {
  modScreen.hidden = false;
  loadModUserList();
}

function closeModMenu() {
  modScreen.hidden = true;
}

function loadModUserList() {
  const q = query(collection(db, "users"));
  const unsubscribe = onSnapshot(q, (snap) => {
    modUserList.innerHTML = "";
    snap.forEach((docSnap) => {
      const user = docSnap.data();
      const row = document.createElement("div");
      row.className = "mod-row";
      row.innerHTML = `
        <div class="chat-avatar">${initials(user.displayName)}</div>
        <div class="mod-row-name">
          <div class="n">${escapeHtml(user.displayName)}</div>
          <div class="e">${escapeHtml(user.email)}</div>
        </div>
        <select class="mod-role-select" data-uid="${user.uid}">
          <option value="member" ${user.role === "member" ? "selected" : ""}>Member</option>
          <option value="admin" ${user.role === "admin" ? "selected" : ""}>Admin</option>
          <option value="owner" ${user.role === "owner" ? "selected" : ""}>Owner</option>
        </select>
        <input type="text" class="mod-tag-input" data-uid="${user.uid}" value="${escapeHtml(user.tag || "")}" placeholder="Custom tag" />
        <button class="mod-ban-btn ${user.banned ? "is-banned" : ""}" data-uid="${user.uid}" data-banned="${user.banned}">
          ${user.banned ? "Unban" : "Ban"}
        </button>
      `;

      // Role change
      row.querySelector(".mod-role-select").addEventListener("change", async (e) => {
        try {
          await updateDoc(doc(db, "users", user.uid), { role: e.target.value });
        } catch (err) {
          console.error("Failed to update role:", err);
        }
      });

      // Tag change
      row.querySelector(".mod-tag-input").addEventListener("blur", async (e) => {
        try {
          await updateDoc(doc(db, "users", user.uid), { tag: e.target.value });
        } catch (err) {
          console.error("Failed to update tag:", err);
        }
      });

      // Ban toggle
      row.querySelector(".mod-ban-btn").addEventListener("click", async (e) => {
        try {
          await updateDoc(doc(db, "users", user.uid), { banned: !user.banned });
        } catch (err) {
          console.error("Failed to update ban status:", err);
        }
      });

      modUserList.appendChild(row);
    });
  }, (error) => {
    console.error("Failed to load mod user list:", error);
    modUserList.innerHTML = "<p>Error loading users</p>";
  });

  return unsubscribe;
}

// Attach event listeners
const btnModMenu = document.getElementById("btn-mod-menu");
const btnCloseMod = document.getElementById("btn-close-mod");

if (btnModMenu) {
  btnModMenu.addEventListener("click", openModMenu);
}

if (btnCloseMod) {
  btnCloseMod.addEventListener("click", closeModMenu);
}
