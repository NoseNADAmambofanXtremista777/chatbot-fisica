import { useEffect, useRef } from "react";
import MessageBubble from "./MessageBubble";
import Composer from "./Composer";

const SUGGESTIONS = [
  "Explícame la ley de Coulomb",
  "¿Qué es un campo magnético?",
  "Resuélveme un ejercicio paso a paso",
];

export default function ChatView({
  history,
  onSend,
  loading,
  onToggleSidebar,
  guestLimitReached,
}) {
  const chatBoxRef = useRef(null);

  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [history, loading]);

  const isEmpty = history.length === 0;

  return (
    <div className="chat-container">
      <header>
        <button className="menu-btn" onClick={onToggleSidebar} aria-label="Abrir historial">
          ☰
        </button>
        <div>
          <h1>⚡ Finx</h1>
          <p>Pregunta sobre teoría o resuelve ejercicios paso a paso</p>
        </div>
      </header>

      <div className="chat-box" ref={chatBoxRef}>
        {isEmpty ? (
          <div>
            <MessageBubble
              role="assistant"
              content="👋 ¡Hola! Soy Finx, tu asistente del curso de física. ¿En qué tema o ejercicio te puedo ayudar hoy?"
            />
            <div className="chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => onSend(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          history.map((msg, i) => (
            <MessageBubble
              key={i}
              role={msg.role}
              content={msg.content}
              attachmentPreview={msg.attachmentPreview}
            />
          ))
        )}

        {loading && (
          <div className="loading">
            <span className="dots">
              <i></i>
              <i></i>
              <i></i>
            </span>
            <span>Pensando la respuesta...</span>
          </div>
        )}
      </div>

      {guestLimitReached && (
        <div className="guest-banner">
          <span>Llegaste al límite de mensajes como invitado. Regístrate para seguir chateando y guardar tu historial.</span>
          <button disabled title="Disponible en la próxima fase">
            Crear cuenta
          </button>
        </div>
      )}

      <Composer onSend={onSend} disabled={loading || guestLimitReached} />
    </div>
  );
}
