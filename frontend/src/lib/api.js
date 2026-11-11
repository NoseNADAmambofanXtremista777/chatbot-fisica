const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

function authHeaders(accessToken) {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

export async function sendChatMessage({
  message,
  history,
  imageBase64,
  imageMime,
  week,
  conversationId,
  accessToken,
}) {
  const res = await fetch(`${API_BASE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(accessToken) },
    body: JSON.stringify({
      message,
      history,
      image_base64: imageBase64 || null,
      image_mime: imageMime || null,
      week: week || null,
      conversation_id: conversationId || null,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "Error al contactar a Finx.");
  }
  return res.json();
}

export async function fetchSources() {
  const res = await fetch(`${API_BASE_URL}/sources`);
  if (!res.ok) throw new Error("No se pudieron cargar las fuentes.");
  return res.json();
}

export async function fetchConversations(accessToken) {
  const res = await fetch(`${API_BASE_URL}/conversations`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) throw new Error("No se pudo cargar el historial.");
  return res.json();
}

export async function fetchConversationMessages(conversationId, accessToken) {
  const res = await fetch(`${API_BASE_URL}/conversations/${conversationId}/messages`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) throw new Error("No se pudo cargar la conversación.");
  return res.json();
}

export async function deleteConversation(conversationId, accessToken) {
  const res = await fetch(`${API_BASE_URL}/conversations/${conversationId}`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
  });
  if (!res.ok) throw new Error("No se pudo eliminar la conversación.");
  return res.json();
}

export async function transcribeAudio(blob, accessToken) {
  const formData = new FormData();
  formData.append("file", blob, "nota-de-voz.webm");
  const res = await fetch(`${API_BASE_URL}/transcribe`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: formData,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "No se pudo transcribir el audio.");
  }
  return res.json();
}
