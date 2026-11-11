const STATUS_LABEL = {
  content: "Disponible",
  exam: "Examen parcial",
  finals: "Exámenes finales",
  pending: "Pendiente",
};

export default function SourcesPanel({ sources, loading, error }) {
  return (
    <div className="chat-container">
      <header>
        <div>
          <h1>📚 Biblioteca del curso</h1>
          <p>Material oficial de física, organizado por semana</p>
        </div>
      </header>
      <div className="chat-box">
        {loading && <p style={{ color: "var(--muted)" }}>Cargando semanas...</p>}
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        {!loading && !error && (
          <div className="library-list" style={{ maxWidth: 640 }}>
            {sources.map((week) => (
              <div className="library-item" key={week.week_number}>
                <div className="library-item-top">
                  <span className="library-week">Semana {week.week_number}</span>
                  <span className={`status-badge status-${week.status}`}>
                    {STATUS_LABEL[week.status] || week.status}
                  </span>
                </div>
                <span className="library-title">{week.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
