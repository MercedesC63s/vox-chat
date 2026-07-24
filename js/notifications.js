// Thin wrapper around the browser Notification API.
// Call requestPermission() once after login; call notify() whenever
// something worth surfacing happens (incoming call, new message).

export async function requestNotificationPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    try { await Notification.requestPermission(); } catch (_) {}
  }
}

export function notify(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body, icon: "assets/favicon.png" });
    n.onclick = () => { window.focus(); n.close(); };
  } catch (_) {
    // Some browsers throw if called from a background/service-worker-less
    // context — safe to ignore, it's a nice-to-have, not core functionality.
  }
}
