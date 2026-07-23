// ============================================================
// PASTE YOUR OWN FIREBASE PROJECT CONFIG BELOW.
// Get this from: Firebase Console → Project settings → General
// → "Your apps" → Web app → SDK setup and configuration.
//
// This is safe to commit/publish on GitHub Pages — these are
// public client identifiers, not secrets. Lock the project down
// with Firestore Security Rules (see README) instead.
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "PASTE_ME",
  authDomain: "PASTE_ME.firebaseapp.com",
  projectId: "PASTE_ME",
  storageBucket: "PASTE_ME.appspot.com",
  messagingSenderId: "PASTE_ME",
  appId: "PASTE_ME"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
