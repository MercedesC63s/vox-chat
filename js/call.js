import { db } from "./firebase-config.js";
import { state } from "./state.js";
import { initials } from "./app.js";
import {
  collection, doc, addDoc, setDoc, updateDoc, onSnapshot, query,
  where, serverTimestamp, deleteDoc, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ICE_SERVERS = {
  iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }]
};

let pc = null;
let localStream = null;
let currentCallId = null;
let isCaller = false;
let unsubCallDoc = null;
let unsubRemoteCandidates = null;
let timerInterval = null;
let isMuted = false;
let isOnHold = false;

const screenIncoming = document.getElementById("screen-incoming");
const screenCall = document.getElementById("screen-call");
const remoteAudio = document.getElementById("remote-audio");

// ---------------- outgoing ----------------
document.getElementById("btn-call").addEventListener("click", startCall);

async function startCall() {
  if (!state.activePeer) return;
  isCaller = true;

  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  pc = new RTCPeerConnection(ICE_SERVERS);
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  attachRemoteTrack();

  const callRef = doc(collection(db, "calls"));
  currentCallId = callRef.id;

  const callerCandidates = collection(callRef, "callerCandidates");
  pc.onicecandidate = (e) => { if (e.candidate) addDoc(callerCandidates, e.candidate.toJSON()); };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  await setDoc(callRef, {
    callerId: state.user.uid,
    callerName: state.profile.displayName,
    calleeId: state.activePeer.uid,
    calleeName: state.activePeer.displayName,
    offer: { type: offer.type, sdp: offer.sdp },
    status: "ringing",
    createdAt: serverTimestamp()
  });

  showCallScreen(screenCall, state.activePeer.displayName, "calling…");

  unsubCallDoc = onSnapshot(callRef, async (snap) => {
    const data = snap.data();
    if (!data) return;
    if (data.status === "accepted" && data.answer && !pc.currentRemoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      document.getElementById("call-status").textContent = "connected";
      startTimer();
      listenForCandidates(callRef, "calleeCandidates");
    }
    if (data.status === "declined") { endCall("declined"); }
    if (data.status === "ended") { endCall(); }
  });
}

// ---------------- incoming ----------------
export function listenForIncomingCalls() {
  const q = query(collection(db, "calls"), where("calleeId", "==", state.user.uid), where("status", "==", "ringing"));
  onSnapshot(q, (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === "added") handleIncomingCall(change.doc.id, change.doc.data());
    });
  });
}

function handleIncomingCall(callId, data) {
  currentCallId = callId;
  isCaller = false;
  document.getElementById("incoming-name").textContent = data.callerName || "Unknown";
  document.getElementById("incoming-initial").textContent = initials(data.callerName);
  screenIncoming.hidden = false;

  const callRef = doc(db, "calls", callId);

  document.getElementById("btn-decline").onclick = async () => {
    screenIncoming.hidden = true;
    await updateDoc(callRef, { status: "declined" });
  };

  document.getElementById("btn-accept").onclick = async () => {
    screenIncoming.hidden = true;
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    pc = new RTCPeerConnection(ICE_SERVERS);
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    attachRemoteTrack();

    const calleeCandidates = collection(callRef, "calleeCandidates");
    pc.onicecandidate = (e) => { if (e.candidate) addDoc(calleeCandidates, e.candidate.toJSON()); };

    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await updateDoc(callRef, {
      status: "accepted",
      answer: { type: answer.type, sdp: answer.sdp }
    });

    showCallScreen(screenCall, data.callerName, "connected");
    startTimer();
    listenForCandidates(callRef, "callerCandidates");

    unsubCallDoc = onSnapshot(callRef, (snap) => {
      const d = snap.data();
      if (d?.status === "ended") endCall();
    });
  };
}

function listenForCandidates(callRef, subcol) {
  unsubRemoteCandidates = onSnapshot(collection(callRef, subcol), (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === "added" && pc) {
        pc.addIceCandidate(new RTCIceCandidate(change.doc.data())).catch(() => {});
      }
    });
  });
}

function attachRemoteTrack() {
  const remoteStream = new MediaStream();
  pc.ontrack = (e) => { e.streams[0].getTracks().forEach(t => remoteStream.addTrack(t)); remoteAudio.srcObject = remoteStream; };
}

// ---------------- UI ----------------
function showCallScreen(screenEl, name, status) {
  document.getElementById("call-peer-name").textContent = name;
  document.getElementById("call-initial").textContent = initials(name);
  document.getElementById("call-status").textContent = status;
  document.getElementById("call-timer").hidden = true;
  document.getElementById("call-timer").textContent = "00:00";
  screenEl.hidden = false;
}

function startTimer() {
  let seconds = 0;
  const timerEl = document.getElementById("call-timer");
  timerEl.hidden = false;
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    seconds++;
    const m = String(Math.floor(seconds / 60)).padStart(2, "0");
    const s = String(seconds % 60).padStart(2, "0");
    timerEl.textContent = `${m}:${s}`;
  }, 1000);
}

// ---------------- controls ----------------
document.getElementById("btn-mute").addEventListener("click", (e) => {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  e.currentTarget.classList.toggle("is-on", isMuted);
});

document.getElementById("btn-hold").addEventListener("click", (e) => {
  if (!localStream) return;
  isOnHold = !isOnHold;
  // Simple local hold: pause outgoing audio and remote playback.
  // (Signaling "on hold" status to the peer's UI is a good next step.)
  localStream.getAudioTracks().forEach(t => t.enabled = !isOnHold);
  if (remoteAudio) isOnHold ? remoteAudio.pause() : remoteAudio.play().catch(() => {});
  document.getElementById("call-status").textContent = isOnHold ? "on hold" : "connected";
  e.currentTarget.classList.toggle("is-on", isOnHold);
});

document.getElementById("btn-hangup").addEventListener("click", async () => {
  if (currentCallId) await updateDoc(doc(db, "calls", currentCallId), { status: "ended" }).catch(() => {});
  endCall();
});

async function endCall(reason) {
  clearInterval(timerInterval);
  if (unsubCallDoc) { unsubCallDoc(); unsubCallDoc = null; }
  if (unsubRemoteCandidates) { unsubRemoteCandidates(); unsubRemoteCandidates = null; }
  if (pc) { pc.close(); pc = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  isMuted = false; isOnHold = false;
  document.getElementById("btn-mute").classList.remove("is-on");
  document.getElementById("btn-hold").classList.remove("is-on");
  screenCall.hidden = true;
  screenIncoming.hidden = true;

  // Light cleanup of the signaling doc's candidate subcollections.
  if (currentCallId) {
    for (const sub of ["callerCandidates", "calleeCandidates"]) {
      const snap = await getDocs(collection(db, "calls", currentCallId, sub)).catch(() => null);
      snap?.forEach(d => deleteDoc(d.ref).catch(() => {}));
    }
  }
  currentCallId = null;
}
