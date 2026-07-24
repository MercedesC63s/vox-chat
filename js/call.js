import { db } from "./firebase-config.js";
import { state } from "./state.js";
import { initials } from "./app.js";
import { notify } from "./notifications.js";
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
let isCameraOff = false;

const screenIncoming = document.getElementById("screen-incoming");
const screenCall = document.getElementById("screen-call");
const callBody = document.querySelector("#screen-call .call-body");
const remoteVideo = document.getElementById("remote-video");
const localVideo = document.getElementById("local-video");

function showScreen(el) { el.hidden = false; el.classList.add("active"); }
function hideScreen(el) { el.hidden = true; el.classList.remove("active"); }

// Try camera + mic; fall back to mic-only if no camera / permission denied,
// so a call can still happen even without video.
async function getLocalStream() {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 480, height: 640 } });
  } catch (err) {
    console.error("Camera unavailable, falling back to audio-only:", err);
    return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  }
}

function setupLocalVideo() {
  const hasVideo = localStream.getVideoTracks().length > 0;
  localVideo.srcObject = localStream;
  localVideo.classList.toggle("no-video", !hasVideo || isCameraOff);
  document.getElementById("btn-camera").hidden = !hasVideo;
}

// ---------------- outgoing ----------------
document.getElementById("btn-call").addEventListener("click", startCall);

async function startCall() {
  if (!state.activePeer) return;
  isCaller = true;

  localStream = await getLocalStream();
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
  setupLocalVideo();

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
  showScreen(screenIncoming);
  notify(`Incoming call — ${data.callerName || "Unknown"}`, "tap to open vox");

  const callRef = doc(db, "calls", callId);

  document.getElementById("btn-decline").onclick = async () => {
    hideScreen(screenIncoming);
    await updateDoc(callRef, { status: "declined" });
  };

  document.getElementById("btn-accept").onclick = async () => {
    hideScreen(screenIncoming);
    localStream = await getLocalStream();
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
    setupLocalVideo();
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
  remoteVideo.srcObject = remoteStream;
  remoteVideo.classList.add("no-video");
  pc.ontrack = (e) => {
    e.streams[0].getTracks().forEach(t => remoteStream.addTrack(t));
    if (e.track.kind === "video") {
      remoteVideo.classList.remove("no-video");
      callBody.classList.add("video-active");
    }
  };
}

// ---------------- UI ----------------
function showCallScreen(screenEl, name, status) {
  document.getElementById("call-peer-name").textContent = name;
  document.getElementById("call-initial").textContent = initials(name);
  document.getElementById("call-status").textContent = status;
  document.getElementById("call-timer").hidden = true;
  document.getElementById("call-timer").textContent = "00:00";
  callBody.classList.remove("video-active");
  remoteVideo.classList.add("no-video");
  showScreen(screenEl);
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

document.getElementById("btn-camera").addEventListener("click", (e) => {
  if (!localStream) return;
  const videoTracks = localStream.getVideoTracks();
  if (videoTracks.length === 0) return;
  isCameraOff = !isCameraOff;
  videoTracks.forEach(t => t.enabled = !isCameraOff);
  localVideo.classList.toggle("no-video", isCameraOff);
  e.currentTarget.classList.toggle("is-on", isCameraOff);
  e.currentTarget.title = isCameraOff ? "Turn camera on" : "Turn camera off";
});

document.getElementById("btn-hold").addEventListener("click", (e) => {
  if (!localStream) return;
  isOnHold = !isOnHold;
  // Simple local hold: pause outgoing audio/video and remote playback.
  // (Signaling "on hold" status to the peer's UI is a good next step.)
  localStream.getTracks().forEach(t => t.enabled = !isOnHold);
  if (remoteVideo) isOnHold ? remoteVideo.pause() : remoteVideo.play().catch(() => {});
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
  isMuted = false; isOnHold = false; isCameraOff = false;
  document.getElementById("btn-mute").classList.remove("is-on");
  document.getElementById("btn-hold").classList.remove("is-on");
  document.getElementById("btn-camera").classList.remove("is-on");
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  callBody.classList.remove("video-active");
  hideScreen(screenCall);
  hideScreen(screenIncoming);

  // Light cleanup of the signaling doc's candidate subcollections.
  if (currentCallId) {
    for (const sub of ["callerCandidates", "calleeCandidates"]) {
      const snap = await getDocs(collection(db, "calls", currentCallId, sub)).catch(() => null);
      snap?.forEach(d => deleteDoc(d.ref).catch(() => {}));
    }
  }
  currentCallId = null;
}
