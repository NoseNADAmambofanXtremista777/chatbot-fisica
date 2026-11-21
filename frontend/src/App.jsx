import { useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import SourcesPanel from "./components/SourcesPanel";
import AuthModal from "./components/AuthModal";
import AgeGateModal from "./components/AgeGateModal";
import { supabase } from "./lib/supabaseClient";
import {
  sendChatMessage,
  fetchSources,
  fetchConversations,
  fetchConversationMessages,
  deleteConversation,
} from "./lib/api";
import {
  loadSessions,
  saveSessions,
  getGuestMessageCount,
  incrementGuestMessageCount,
  GUEST_MESSAGE_LIMIT,
} from "./lib/storage";

function createSession() {
  return { title: "Nueva conversación", history: [] };
}

export default function App() {
  // Sesion de Supabase
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [ageBlockedMessage, setAgeBlockedMessage] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Modo invitado: todo en localStorage. currentLocalId arranca en null a
  // proposito: cada apertura nueva del sitio debe mostrar un chat nuevo, el
  // historial anterior se conserva en localSessions y queda en el sidebar.
  const [localSessions, setLocalSessions] = useState(() => loadSessions());
  const [currentLocalId, setCurrentLocalId] = useState(null);
  const [guestMessageCount, setGuestMessageCount] = useState(() => getGuestMessageCount());

  // Modo autenticado: conversaciones persistidas en Supabase (via backend)
  const [remoteConversations, setRemoteConversations] = useState({}); // id -> {title}
  const [remoteHistory, setRemoteHistory] = useState({}); // id -> history[]
  const [currentRemoteId, setCurrentRemoteId] = useState(null);
  // Historial optimista de un chat autenticado que aun no tiene conversation_id
  // (el backend lo crea recien con el primer mensaje).
  const [pendingHistory, setPendingHistory] = useState([]);

  const [view, setView] = useState("chat");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const [sources, setSources] = useState([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError, setSourcesError] = useState(null);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);

  const isAuthed = !!user;

  // --- Sesion de Supabase: carga inicial + cambios (login/logout/refresh) ---
  useEffect(() => {
    if (!supabase) {
      setAuthChecked(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user || null);
      setAccessToken(data.session?.access_token || null);
      setAuthChecked(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
      setAccessToken(session?.access_token || null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // --- Modo invitado: siempre arranca un chat nuevo una vez que ya se sabe
  // que no hay sesion (esperamos a authChecked para no crear un chat invitado
  // "fantasma" mientras todavia se esta confirmando una sesion existente).
  useEffect(() => {
    if (!authChecked || isAuthed) return;
    const newId = `session_${Date.now()}`;
    setLocalSessions((prev) => {
      const next = { ...prev, [newId]: createSession() };
      saveSessions(next);
      return next;
    });
    setCurrentLocalId(newId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, isAuthed]);

  // --- Modo autenticado: cargar lista de conversaciones al iniciar sesion ---
  useEffect(() => {
    if (!isAuthed || !accessToken) return;
    fetchConversations(accessToken)
      .then((data) => {
        const dict = {};
        data.forEach((c) => {
          dict[c.id] = { title: c.title };
        });
        setRemoteConversations(dict);
        setCurrentRemoteId(null);
      })
      .catch((err) => console.error(err));
  }, [isAuthed, accessToken]);

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

  function persistLocal(nextSessions) {
    setLocalSessions(nextSessions);
    saveSessions(nextSessions);
  }

  function handleNewChat() {
    if (isAuthed) {
      setCurrentRemoteId(null);
      setPendingHistory([]);
    } else {
      const newId = `session_${Date.now()}`;
      const next = { ...localSessions, [newId]: createSession() };
      persistLocal(next);
      setCurrentLocalId(newId);
    }
    setView("chat");
    setSidebarOpen(false);
  }

  async function handleSelectChat(id) {
    if (isAuthed) {
      setCurrentRemoteId(id);
      setPendingHistory([]);
      if (!remoteHistory[id]) {
        try {
          const msgs = await fetchConversationMessages(id, accessToken);
          setRemoteHistory((prev) => ({
            ...prev,
            [id]: msgs.map((m) => ({ role: m.role, content: m.content })),
          }));
        } catch (err) {
          console.error(err);
        }
      }
    } else {
      setCurrentLocalId(id);
    }
    setView("chat");
    setSidebarOpen(false);
  }

  async function handleDeleteChat(id) {
    if (isAuthed) {
      try {
        await deleteConversation(id, accessToken);
      } catch (err) {
        console.error(err);
      }
      const nextConvs = { ...remoteConversations };
      delete nextConvs[id];
      const nextHistory = { ...remoteHistory };
      delete nextHistory[id];
      setRemoteConversations(nextConvs);
      setRemoteHistory(nextHistory);
      if (currentRemoteId === id) setCurrentRemoteId(null);
    } else {
      const next = { ...localSessions };
      delete next[id];
      if (currentLocalId === id) {
        const remaining = Object.keys(next);
        if (remaining.length > 0) {
          const fallbackId = remaining[remaining.length - 1];
          setCurrentLocalId(fallbackId);
        } else {
          const newId = `session_${Date.now()}`;
          next[newId] = createSession();
          setCurrentLocalId(newId);
        }
      }
      persistLocal(next);
    }
  }

  function handleSignOut() {
    supabase?.auth.signOut();
    setRemoteConversations({});
    setRemoteHistory({});
    setCurrentRemoteId(null);
    setPendingHistory([]);
  }

  const guestLimitReached = !isAuthed && guestMessageCount >= GUEST_MESSAGE_LIMIT;

  async function handleSend(text, attachment) {
    if (guestLimitReached) return;

    if (isAuthed) {
      const idKey = currentRemoteId;
      const priorHistory = idKey ? remoteHistory[idKey] || [] : pendingHistory;
      const userMessage = {
        role: "user",
        content: text,
        attachmentPreview: attachment?.previewUrl,
      };
      const optimisticHistory = [...priorHistory, userMessage];
      if (idKey) {
        setRemoteHistory((prev) => ({ ...prev, [idKey]: optimisticHistory }));
      } else {
        setPendingHistory(optimisticHistory);
      }
      setLoading(true);
      try {
        const data = await sendChatMessage({
          message: text,
          history: priorHistory,
          imageBase64: attachment?.base64,
          imageMime: attachment?.mime,
          conversationId: idKey,
          accessToken,
        });
        const realId = data.conversation_id;
        const assistantMessage = { role: "assistant", content: data.response };
        const finalHistory = [...optimisticHistory, assistantMessage];

        if (realId) {
          setRemoteHistory((prev) => {
            const next = { ...prev };
            if (idKey && idKey !== realId) delete next[idKey];
            next[realId] = finalHistory;
            return next;
          });
          setCurrentRemoteId(realId);
          setPendingHistory([]);
          if (!idKey) {
            // Conversacion nueva: refresca la lista para traer el titulo real.
            fetchConversations(accessToken)
              .then((convs) => {
                const dict = {};
                convs.forEach((c) => {
                  dict[c.id] = { title: c.title };
                });
                setRemoteConversations(dict);
              })
              .catch(() => {});
          }
        } else if (idKey) {
          setRemoteHistory((prev) => ({ ...prev, [idKey]: finalHistory }));
        } else {
          setPendingHistory(finalHistory);
        }
      } catch (err) {
        const errorMessage = {
          role: "assistant",
          content: `❌ ${err.message || "Error al contactar a Finx."}`,
        };
        if (idKey) {
          setRemoteHistory((prev) => ({ ...prev, [idKey]: [...optimisticHistory, errorMessage] }));
        } else {
          setPendingHistory([...optimisticHistory, errorMessage]);
        }
      } finally {
        setLoading(false);
      }
      return;
    }

    // Modo invitado
    if (!currentLocalId) return;
    const session = localSessions[currentLocalId];
    const wasEmpty = session.history.length === 0;
    const historyForBackend = session.history.slice();
    const userMessage = { role: "user", content: text, attachmentPreview: attachment?.previewUrl };

    let next = {
      ...localSessions,
      [currentLocalId]: {
        ...session,
        title:
          session.history.length === 0
            ? text.slice(0, 22) + (text.length > 22 ? "..." : "")
            : session.title,
        history: [...session.history, userMessage],
      },
    };
    persistLocal(next);
    setLoading(true);

    try {
      const data = await sendChatMessage({
        message: text,
        history: historyForBackend,
        imageBase64: attachment?.base64,
        imageMime: attachment?.mime,
      });
      const assistantMessage = { role: "assistant", content: data.response };
      next = {
        ...next,
        [currentLocalId]: {
          ...next[currentLocalId],
          title: wasEmpty && data.title ? data.title : next[currentLocalId].title,
          history: [...next[currentLocalId].history, assistantMessage],
        },
      };
      persistLocal(next);
      setGuestMessageCount(incrementGuestMessageCount());
    } catch (err) {
      next = {
        ...next,
        [currentLocalId]: {
          ...next[currentLocalId],
          history: [
            ...next[currentLocalId].history,
            { role: "assistant", content: `❌ ${err.message || "Hubo un error al contactar a Finx."}` },
          ],
        },
      };
      persistLocal(next);
    } finally {
      setLoading(false);
    }
  }

  // Cubre el login con Google (no pasa por el formulario de registro propio):
  // si ya hay sesion pero el usuario nunca confirmo su fecha de nacimiento,
  // se le pide antes de dejarlo usar la app (COPPA).
  const needsAgeConfirmation = isAuthed && !user.user_metadata?.birthdate;

  const sidebarSessions = isAuthed ? remoteConversations : localSessions;
  const sidebarCurrentId = isAuthed ? currentRemoteId : currentLocalId;
  const currentHistory = isAuthed
    ? (currentRemoteId ? remoteHistory[currentRemoteId] || [] : pendingHistory)
    : localSessions[currentLocalId]?.history || [];

  return (
    <div className="app-layout">
      <Sidebar
        open={sidebarOpen}
        view={view}
        onChangeView={(v) => {
          setView(v);
          setSidebarOpen(false);
        }}
        sessions={sidebarSessions}
        currentSessionId={sidebarCurrentId}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
        user={user}
        onOpenAuth={() => setAuthModalOpen(true)}
        onSignOut={handleSignOut}
      />
      <div
        className={`overlay ${sidebarOpen ? "show" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />

      {view === "library" ? (
        <SourcesPanel sources={sources} loading={sourcesLoading} error={sourcesError} />
      ) : (
        <ChatView
          history={currentHistory}
          onSend={handleSend}
          loading={loading}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          guestLimitReached={guestLimitReached}
          onOpenAuth={() => setAuthModalOpen(true)}
        />
      )}

      {authModalOpen && <AuthModal onClose={() => setAuthModalOpen(false)} />}

      {needsAgeConfirmation && (
        <AgeGateModal onBlocked={(message) => setAgeBlockedMessage(message)} />
      )}

      {ageBlockedMessage && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>No podemos crear tu cuenta</h2>
            <p className="modal-sub">{ageBlockedMessage}</p>
            <button className="new-chat-btn" onClick={() => setAgeBlockedMessage(null)}>
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
