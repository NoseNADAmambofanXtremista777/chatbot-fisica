import { useRef, useState } from "react";
import { transcribeAudio } from "../lib/api";

export default function Composer({ onSend, disabled }) {
  const [text, setText] = useState("");
  const [attachment, setAttachment] = useState(null); // { base64, mime, previewUrl }
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  function handleSend() {
    const trimmed = text.trim();
    if ((!trimmed && !attachment) || disabled) return;
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
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const base64 = dataUrl.split(",")[1];
      setAttachment({ base64, mime: file.type || "image/jpeg", previewUrl: dataUrl });
    };
    reader.readAsDataURL(file);
  }

  async function handleToggleRecording() {
    if (recording) {
      mediaRecorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setTranscribing(true);
        try {
          const { text: transcript } = await transcribeAudio(blob);
          setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
        } catch (err) {
          setText((prev) => prev); // deja el texto como estaba
          console.error(err);
        } finally {
          setTranscribing(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (err) {
      console.error("No se pudo acceder al micrófono:", err);
    }
  }

  return (
    <div className="input-container">
      {attachment && (
        <div className="attachment-preview">
          <img src={attachment.previewUrl} alt="Vista previa" />
          <span>Imagen lista para enviar</span>
          <button onClick={() => setAttachment(null)} aria-label="Quitar imagen">
            ✕
          </button>
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
        >
          Enviar
        </button>
      </div>
    </div>
  );
}
