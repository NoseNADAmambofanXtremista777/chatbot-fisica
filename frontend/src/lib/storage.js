const CHATS_KEY = "finx_chats";
const GUEST_COUNT_KEY = "finx_guest_message_count";

export const GUEST_MESSAGE_LIMIT = 10;

export function loadSessions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHATS_KEY)) || {};
    // Limpia chats vacios acumulados por versiones anteriores (que creaban
    // uno nuevo en cada recarga/login/logout sin que el usuario escribiera
    // nada).
    const cleaned = {};
    let hadEmpty = false;
    for (const [id, session] of Object.entries(parsed)) {
      if (session?.history?.length > 0) {
        cleaned[id] = session;
      } else {
        hadEmpty = true;
      }
    }
    if (hadEmpty) saveSessions(cleaned);
    return cleaned;
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
