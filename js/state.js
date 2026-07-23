// Small shared state object so app.js, chat.js, and call.js
// don't have to pass everything through events.
export const state = {
  user: null,          // firebase auth user
  profile: null,        // { uid, displayName, email }
  activeChatId: null,
  activePeer: null,     // { uid, displayName, email }
  unsubMessages: null,  // firestore listener teardown for current chat
};
