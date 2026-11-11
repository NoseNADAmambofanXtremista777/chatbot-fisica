import { useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import SourcesPanel from "./components/SourcesPanel";
import { sendChatMessage, fetchSources } from "./lib/api";
import {
  loadSessions,
  saveSessions,
  loadCurrentSessionId,
  saveCurrentSessionId,
  getGuestMessageCount,
  incrementGuestMessageCount,
  GUEST_MESSAGE_LIMIT,
} from "./lib/storage";

function createSession() {
  return { title: "Nueva conversación", history: [] };
}

export default function App() {
  const [sessions, setSessions] = useState(() => loadSessions());
  const [currentSessionId, setCurrentSessionId] = useState(() => loadCurrentSessionId());
  const [view, setView] = useState("chat");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [guestMessageCount, setGuestMessageCount] = useState(() => getGuestMessageCount());

  const [sources, setSources] = useState([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError, setSourcesError] = useState(null);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);

  useEffect(() => {
    if (!currentSessionId || !sessions[currentSessionId]) {
      const newId = `session_${Date.now()}`;
      const next = { ...sessions, [newId]: createSession() };
      setSessions(next);
      setCurrentSessionId(newId);
      saveSessions(next);
      saveCurrentSessionId(newId);
    }
    // Solo al montar: si ya existe sesión guardada, se respeta tal cual.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (view === "library" && !sourcesLoaded) {
      setSourcesLoading(true);
      setSourcesError(null);
      fetchSources()
        .then((data) => {
          setSources(data);
          setSourcesLoaded(true);
        })
        .catch((err) => setSourcesError(err.message))
        .finally(() => setSourcesLoading(false));
    }
  }, [view, sourcesLoaded]);

  function persist(nextSessions) {
    setSessions(nextSessions);
    saveSessions(nextSessions);
  }

  function handleNewChat() {
    const newId = `session_${Date.now()}`;
    const next = { ...sessions, [newId]: createSession() };
    persist(next);
    setCurrentSessionId(newId);
    saveCurrentSessionId(newId);
    setView("chat");
    setSidebarOpen(false);
  }

  function handleSelectChat(id) {
    setCurrentSessionId(id);
    saveCurrentSessionId(id);
    setView("chat");
    setSidebarOpen(false);
  }

  function handleDeleteChat(id) {
    const next = { ...sessions };
    delete next[id];
    if (currentSessionId === id) {
      const remaining = Object.keys(next);
      if (remaining.length > 0) {
        const fallbackId = remaining[remaining.length - 1];
        setCurrentSessionId(fallbackId);
        saveCurrentSessionId(fallbackId);
      } else {
        const newId = `session_${Date.now()}`;
        next[newId] = createSession();
        setCurrentSessionId(newId);
        saveCurrentSessionId(newId);
      }
    }
    persist(next);
  }

  const guestLimitReached = guestMessageCount >= GUEST_MESSAGE_LIMIT;

  async function handleSend(text) {
    if (!currentSessionId || guestLimitReached) return;
    const session = sessions[currentSessionId];
    const historyForBackend = session.history.slice();

    const userMessage = { role: "user", content: text };
    let next = {
      ...sessions,
      [currentSessionId]: {
        ...session,
        title: session.history.length === 0 ? text.slice(0, 22) + (text.length > 22 ? "..." : "") : session.title,
        history: [...session.history, userMessage],
      },
    };
    persist(next);
    setLoading(true);

    try {
      const data = await sendChatMessage({ message: text, history: historyForBackend });
      const assistantMessage = { role: "assistant", content: data.response };
      next = {
        ...next,
        [currentSessionId]: {
          ...next[currentSessionId],
          history: [...next[currentSessionId].history, assistantMessage],
        },
      };
      persist(next);
      setGuestMessageCount(incrementGuestMessageCount());
    } catch (err) {
      const assistantMessage = {
        role: "assistant",
        content: `❌ ${err.message || "Hubo un error al contactar a Finx."}`,
      };
      next = {
        ...next,
        [currentSessionId]: {
          ...next[currentSessionId],
          history: [...next[currentSessionId].history, assistantMessage],
        },
      };
      persist(next);
    } finally {
      setLoading(false);
    }
  }

  const currentSession = currentSessionId ? sessions[currentSessionId] : null;

  return (
    <div className="app-layout">
      <Sidebar
        open={sidebarOpen}
        view={view}
        onChangeView={(v) => {
          setView(v);
          setSidebarOpen(false);
        }}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
      />
      <div
        className={`overlay ${sidebarOpen ? "show" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />

      {view === "library" ? (
        <SourcesPanel sources={sources} loading={sourcesLoading} error={sourcesError} />
      ) : (
        currentSession && (
          <ChatView
            history={currentSession.history}
            onSend={handleSend}
            loading={loading}
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
            guestLimitReached={guestLimitReached}
          />
        )
      )}
    </div>
  );
}
