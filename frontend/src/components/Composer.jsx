import { useState } from "react";

export default function Composer({ onSend, disabled }) {
  const [text, setText] = useState("");

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") handleSend();
  }

  return (
    <div className="input-container">
      <div className="input-wrap">
        <button
          className="icon-btn"
          type="button"
          disabled
          title="Adjuntar imagen (disponible en la próxima fase)"
        >
          📷
        </button>
        <button
          className="icon-btn"
          type="button"
          disabled
          title="Grabar nota de voz (disponible en la próxima fase)"
        >
          🎤
        </button>
        <input
          type="text"
          value={text}
          placeholder="Escribe tu pregunta sobre física aquí..."
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button className="send-btn" onClick={handleSend} disabled={disabled || !text.trim()}>
          Enviar
        </button>
      </div>
    </div>
  );
}
