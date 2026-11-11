import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function AuthModal({ onClose }) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);

  if (!supabase) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <p>Supabase no está configurado en este entorno.</p>
          <button className="new-chat-btn" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        setInfo("Cuenta creada. Revisa tu correo para confirmar antes de iniciar sesión.");
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        onClose();
      }
    } catch (err) {
      setError(err.message || "Ocurrió un error.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    try {
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      if (err) throw err;
    } catch (err) {
      setError(err.message || "No se pudo iniciar sesión con Google.");
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{mode === "signup" ? "Crear cuenta" : "Iniciar sesión"}</h2>
        <p className="modal-sub">Guarda tu historial de chats con Finx.</p>

        <button className="google-btn" type="button" onClick={handleGoogle}>
          Continuar con Google
        </button>

        <div className="modal-divider">o con tu correo</div>

        <form onSubmit={handleSubmit} className="modal-form">
          <input
            type="email"
            placeholder="correo@ejemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />
          {error && <p className="modal-error">{error}</p>}
          {info && <p className="modal-info">{info}</p>}
          <button className="new-chat-btn" type="submit" disabled={loading}>
            {loading ? "Un momento..." : mode === "signup" ? "Crear cuenta" : "Entrar"}
          </button>
        </form>

        <button
          className="modal-switch"
          type="button"
          onClick={() => {
            setMode(mode === "signup" ? "signin" : "signup");
            setError(null);
            setInfo(null);
          }}
        >
          {mode === "signup" ? "¿Ya tienes cuenta? Inicia sesión" : "¿No tienes cuenta? Regístrate"}
        </button>
      </div>
    </div>
  );
}
