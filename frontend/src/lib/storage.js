const CHATS_KEY = "finx_chats";
const CURRENT_KEY = "finx_current_session";
const GUEST_COUNT_KEY = "finx_guest_message_count";

export const GUEST_MESSAGE_LIMIT = 10;

export function loadSessions() {
  try {
    return JSON.parse(localStorage.getItem(CHATS_KEY)) || {};
  } catch {
    return {};
  }
}

export function saveSessions(sessions) {
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify(sessions));
  } catch {
    // localStorage no disponible (modo privado, cuota llena, etc.)
  }
}

export function loadCurrentSessionId() {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

export function saveCurrentSessionId(id) {
  try {
    localStorage.setItem(CURRENT_KEY, id);
  } catch {
    // ignorar
  }
}

export function getGuestMessageCount() {
  try {
    return parseInt(localStorage.getItem(GUEST_COUNT_KEY) || "0", 10);
  } catch {
    return 0;
  }
}

export function incrementGuestMessageCount() {
  const next = getGuestMessageCount() + 1;
  try {
    localStorage.setItem(GUEST_COUNT_KEY, String(next));
  } catch {
    // ignorar
  }
  return next;
}
