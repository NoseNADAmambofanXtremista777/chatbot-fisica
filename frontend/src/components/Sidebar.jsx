export default function Sidebar({
  open,
  view,
  onChangeView,
  sessions,
  currentSessionId,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  user,
  onOpenAuth,
  onSignOut,
}) {
  const orderedIds = Object.keys(sessions).reverse();

  return (
    <div className={`sidebar ${open ? "open" : ""}`}>
      <div className="brand">
        <img className="brand-logo" src="/finx-logo.png" alt="Finx" />
        <div>
          <div className="brand-name">Finx</div>
          <div className="brand-sub">Tu asistente de física</div>
        </div>
      </div>

      <button className="new-chat-btn" onClick={onNewChat}>
        + Nuevo chat
      </button>

      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${view === "chat" ? "active" : ""}`}
          onClick={() => onChangeView("chat")}
        >
          Chats
        </button>
        <button
          className={`sidebar-tab ${view === "library" ? "active" : ""}`}
          onClick={() => onChangeView("library")}
        >
          Biblioteca
        </button>
      </div>

      {view === "chat" && (
        <div className="chat-list">
          {orderedIds.map((id) => (
            <div
              key={id}
              className={`chat-item ${id === currentSessionId ? "active" : ""}`}
              tabIndex={0}
              onClick={() => onSelectChat(id)}
              onKeyDown={(e) => e.key === "Enter" && onSelectChat(id)}
            >
              <span>{sessions[id].title}</span>
              <button
                className="delete-btn"
                aria-label="Eliminar chat"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteChat(id);
                }}
              >
                🗑️
              </button>
            </div>
          ))}
        </div>
      )}

      {user ? (
        <button className="profile-btn" onClick={onSignOut} title="Cerrar sesión">
          <span className="profile-avatar">{user.email?.[0]?.toUpperCase() || "U"}</span>
          <span>{user.email} · Salir</span>
        </button>
      ) : (
        <button className="profile-btn" onClick={onOpenAuth}>
          <span className="profile-avatar">I</span>
          <span>Invitado · Iniciar sesión</span>
        </button>
      )}
    </div>
  );
}
