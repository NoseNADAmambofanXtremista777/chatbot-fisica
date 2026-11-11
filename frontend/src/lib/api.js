const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export async function sendChatMessage({ message, history, imageBase64, imageMime, week }) {
  const res = await fetch(`${API_BASE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      history,
      image_base64: imageBase64 || null,
      image_mime: imageMime || null,
      week: week || null,
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
