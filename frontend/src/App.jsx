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

// El boton de descarga solo debe aparecer cuando el usuario pidio un
// documento/PDF explicitamente, no en cualquier respuesta larga.
function userAskedForDocument(text) {
  return /\b(pdf|documento|apunte)s?\b/i.test(text || "");
}

export default function App() {
  // Sesion de Supabase
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [ageBlockedMessage, setAgeBlockedMessage] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Modo invitado: todo en localStorage. currentLocalId arranca en null (chat
  // en blanco, como el modo autenticado) y no se guarda nada en el sidebar
  // hasta que el usuario manda su primer mensaje -- asi evitamos acumular
  // "Nueva conversacion" vacias por cada recarga, login/logout, etc.
  const [localSessions, setLocalSessions] = useState(() => loadSessions());
  const [currentLocalId, setCurrentLocalId] = useState(null);
  const [pendingLocalHistory, setPendingLocalHistory] = useState([]);
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

  // --- Modo autenticado: cargar lista de conversaciones al iniciar sesion ---
  // OJO: este efecto depende de "accessToken", y supabase-js dispara
  // onAuthStateChange (arriba) cada vez que renueva el token en segundo
  // plano (TOKEN_REFRESHED), no solo al iniciar sesion. Antes este efecto
  // hacia setCurrentRemoteId(null) aca, asi que cada renovacion de token
  // mientras el usuario chateaba le borraba la conversacion activa sin
  // avisar: el siguiente mensaje llegaba al backend sin conversation_id y
  // creaba una conversacion NUEVA en vez de continuar la misma -- por eso
  // cada pregunta terminaba en un chat distinto con su propio titulo. Este
  // efecto solo debe refrescar los titulos de la lista; nunca debe tocar
  // cual conversacion esta activa (eso lo maneja handleNewChat/handleSelectChat).
  useEffect(() => {
    if (!isAuthed || !accessToken) return;
    fetchConversations(accessToken)
      .then((data) => {
        const dict = {};
        data.forEach((c) => {
          dict[c.id] = { title: c.title };
        });
        setRemoteConversations(dict);
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
      setCurrentLocalId(null);
      setPendingLocalHistory([]);
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
      setPendingLocalHistory([]);
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
      persistLocal(next);
      if (currentLocalId === id) {
        const remaining = Object.keys(next);
        if (remaining.length > 0) {
          setCurrentLocalId(remaining[remaining.length - 1]);
        } else {
          setCurrentLocalId(null);
          setPendingLocalHistory([]);
        }
      }
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
        const assistantMessage = {
          role: "assistant",
          content: data.response,
          wantsPdf: userAskedForDocument(text),
        };
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

    // Modo invitado: si no hay chat activo todavia (borrador en blanco), recien
    // ahora se crea y se persiste la sesion, con el primer mensaje adentro --
    // asi nunca queda guardado un chat vacio por abrir la app o loguear/
    // desloguear sin haber escrito nada.
    const idKey = currentLocalId;
    const isNew = !idKey;
    const workingId = idKey || `session_${Date.now()}`;
    const priorHistory = idKey ? localSessions[idKey].history : pendingLocalHistory;
    const historyForBackend = priorHistory.slice();
    const userMessage = { role: "user", content: text, attachmentPreview: attachment?.previewUrl };
    const optimisticHistory = [...priorHistory, userMessage];

    let next = {
      ...localSessions,
      [workingId]: isNew
        ? { title: text.slice(0, 22) + (text.length > 22 ? "..." : ""), history: optimisticHistory }
        : { ...localSessions[workingId], history: optimisticHistory },
    };
    persistLocal(next);
    if (isNew) {
      setCurrentLocalId(workingId);
      setPendingLocalHistory([]);
    }
    setLoading(true);

    try {
      const data = await sendChatMessage({
        message: text,
        history: historyForBackend,
        imageBase64: attachment?.base64,
        imageMime: attachment?.mime,
      });
      const assistantMessage = {
        role: "assistant",
        content: data.response,
        wantsPdf: userAskedForDocument(text),
      };
      next = {
        ...next,
        [workingId]: {
          ...next[workingId],
          title: isNew && data.title ? data.title : next[workingId].title,
          history: [...next[workingId].history, assistantMessage],
        },
      };
      persistLocal(next);
      setGuestMessageCount(incrementGuestMessageCount());
    } catch (err) {
      next = {
        ...next,
        [workingId]: {
          ...next[workingId],
          history: [
            ...next[workingId].history,
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
    : (currentLocalId ? localSessions[currentLocalId]?.history || [] : pendingLocalHistory);

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
