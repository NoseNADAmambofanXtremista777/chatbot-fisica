import { useEffect, useRef, useState } from "react";
import { transcribeAudio } from "../lib/api";

function formatElapsed(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // debe coincidir con el limite del backend
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export default function Composer({ onSend, disabled }) {
  const [text, setText] = useState("");
  const [attachment, setAttachment] = useState(null); // { base64, mime, previewUrl }
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(null);

  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!recording) return undefined;
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timerRef.current);
  }, [recording]);

  function handleSend() {
    const trimmed = text.trim();
    if ((!trimmed && !attachment) || disabled) return;
    setError(null);
    onSend(trimmed, attachment);
    setText("");
    setAttachment(null);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") handleSend();
  }

  function handlePickImage() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setError("Formato de imagen no permitido. Usa JPG, PNG, WEBP o GIF.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("La imagen es demasiado grande (máx. 6 MB).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const base64 = dataUrl.split(",")[1];
      setAttachment({ base64, mime: file.type || "image/jpeg", previewUrl: dataUrl });
    };
    reader.onerror = () => setError("No se pudo leer la imagen. Intenta con otro archivo.");
    reader.readAsDataURL(file);
  }

  async function handleToggleRecording() {
    if (recording) {
      mediaRecorderRef.current?.stop();
      return;
    }
    setError(null);
    try {
      // autoGainControl sube el volumen de una voz grabada baja (la causa
      // mas comun de que Whisper entienda mal una palabra); echoCancellation
      // y noiseSuppression limpian ruido de fondo antes de grabar.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (blob.size === 0) {
          setError("No se grabó audio. Revisa que el micrófono esté funcionando e intenta de nuevo.");
          return;
        }
        setTranscribing(true);
        try {
          const { text: transcript } = await transcribeAudio(blob);
          setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
        } catch (err) {
          setError(err.message || "No se pudo transcribir el audio. Intenta de nuevo.");
        } finally {
          setTranscribing(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (err) {
      setError("No se pudo acceder al micrófono. Revisa los permisos del navegador.");
    }
  }

  return (
    <div className="input-container">
      {error && (
        <div className="composer-error">
          <span>⚠️ {error}</span>
          <button onClick={() => setError(null)} aria-label="Descartar error">
            ✕
          </button>
        </div>
      )}
      {attachment && (
        <div className="attachment-preview">
          <img src={attachment.previewUrl} alt="Vista previa" />
          <span>Imagen lista para enviar</span>
          <button onClick={() => setAttachment(null)} aria-label="Quitar imagen">
            ✕
          </button>
        </div>
      )}

      {recording && (
        <div className="recording-banner">
          <span className="recording-dot" aria-hidden="true" />
          Grabando... {formatElapsed(elapsed)} · toca el micrófono para detener
        </div>
      )}

      <div className="input-wrap">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
        <button
          className="icon-btn"
          type="button"
          onClick={handlePickImage}
          disabled={disabled}
          title="Adjuntar imagen"
        >
          📷
        </button>
        <button
          className={`icon-btn ${recording ? "recording" : ""}`}
          type="button"
          onClick={handleToggleRecording}
          disabled={disabled || transcribing}
          title={recording ? "Detener grabación" : "Grabar nota de voz"}
        >
          🎤
        </button>
        <input
          type="text"
          value={text}
          placeholder={transcribing ? "Transcribiendo audio..." : "Escribe tu pregunta sobre física aquí..."}
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={transcribing}
        />
        <button
          className="send-btn"
          onClick={handleSend}
          disabled={disabled || transcribing || (!text.trim() && !attachment)}
          title="Enviar"
        >
          <span className="send-label">Enviar</span>
          <span className="send-icon" aria-hidden="true">➤</span>
        </button>
      </div>
    </div>
  );
}
