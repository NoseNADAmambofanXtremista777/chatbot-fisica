import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { calculateAge, MIN_AGE } from "../lib/age";

export default function AgeGateModal({ onBlocked }) {
  const [birthdate, setBirthdate] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!birthdate) {
      setError("Ingresa tu fecha de nacimiento.");
      return;
    }
    const age = calculateAge(birthdate);
    if (age < MIN_AGE) {
      await supabase.auth.signOut();
      onBlocked(`Este servicio no está dirigido a menores de ${MIN_AGE} años.`);
      return;
    }
    setLoading(true);
    try {
      // auth.updateUser dispara un evento USER_UPDATED que refresca la sesion
      // en App.jsx, asi que no hace falta notificar manualmente desde aca.
      const { error: err } = await supabase.auth.updateUser({ data: { birthdate } });
      if (err) throw err;
    } catch (err) {
      setError(err.message || "No se pudo guardar tu fecha de nacimiento.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>Confirma tu edad</h2>
        <p className="modal-sub">
          Antes de continuar, necesitamos tu fecha de nacimiento. Este servicio no está
          dirigido a menores de {MIN_AGE} años.
        </p>
        <form onSubmit={handleSubmit} className="modal-form">
          <label className="modal-field-label">
            Fecha de nacimiento
            <input
              type="date"
              value={birthdate}
              onChange={(e) => setBirthdate(e.target.value)}
              max={new Date().toISOString().split("T")[0]}
              required
            />
          </label>
          {error && <p className="modal-error">{error}</p>}
          <button className="new-chat-btn" type="submit" disabled={loading}>
            {loading ? "Un momento..." : "Continuar"}
          </button>
        </form>
      </div>
    </div>
  );
}
