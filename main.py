import os
import re
import traceback
from datetime import datetime, timezone
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_groq import ChatGroq
from langchain_huggingface import HuggingFaceEmbeddings
from groq import Groq as GroqAudioClient
from supabase import create_client

load_dotenv()

app = FastAPI(title="Finx - Asistente Virtual de Fisica")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_CHAT_MODEL = os.getenv("GROQ_CHAT_MODEL", "openai/gpt-oss-120b")
# El catalogo de modelos con vision de Groq cambia seguido (hoy en preview).
# Verificar vigencia en https://console.groq.com/docs/vision antes de asumir
# que este modelo sigue disponible.
GROQ_VISION_MODEL = os.getenv("GROQ_VISION_MODEL", "qwen/qwen3.8-27b")
GROQ_WHISPER_MODEL = os.getenv("GROQ_WHISPER_MODEL", "whisper-large-v3")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY")

# 1. Embeddings con HuggingFace (100% local, sin cuotas)
embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

# 2. Modelos de Groq: texto y vision
llm = ChatGroq(model=GROQ_CHAT_MODEL, temperature=0.3, groq_api_key=GROQ_API_KEY)
vision_llm = ChatGroq(model=GROQ_VISION_MODEL, temperature=0.3, groq_api_key=GROQ_API_KEY)

# 3. Cliente directo de Groq para transcripcion de audio (Whisper)
groq_audio_client = GroqAudioClient(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

# 4. Supabase: pgvector (RAG) + historial de conversaciones
supabase = (
    create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)
    if SUPABASE_URL and SUPABASE_SECRET_KEY
    else None
)
if supabase is None:
    print("Advertencia: SUPABASE_URL/SUPABASE_SECRET_KEY no configurados. El RAG y /sources no funcionaran.")

WEEK_PATTERN = re.compile(r"semana\s*0*(\d{1,2})", re.IGNORECASE)

REFUSAL_MESSAGE = (
    "Lo siento, estoy programado exclusivamente para resolver dudas y problemas "
    "del curso de física basándome en el material oficial."
)

SYSTEM_PROMPT = f"""Eres Finx, el asistente virtual del curso de física. Tu única función es ayudar con teoría, fórmulas y ejercicios de ese curso, apoyándote en el 'Contexto' oficial que se te entrega.

REGLAS ESTRICTAS (en este orden):
1. Si el 'Contexto' tiene información relevante para la pregunta, úsala como fuente principal de tu respuesta.
2. Si no hay contexto relevante pero la pregunta es sobre física en general (electricidad, magnetismo, circuitos u otros temas propios de un curso introductorio de física), puedes responder con tu conocimiento de física.
3. Si la pregunta NO tiene relación alguna con física ni con el curso (temas personales, otras materias, entretenimiento, trivia general, etc.), responde ÚNICAMENTE con este mensaje exacto, sin agregar nada más:
"{REFUSAL_MESSAGE}"
4. Los saludos y la cortesía básica (hola, gracias, cómo estás) sí puedes responderlos brevemente y con amabilidad; no apliques la regla 3 en esos casos.
5. Sé claro, preciso y conciso. Para fórmulas usa ÚNICAMENTE notación con signos de dólar: $...$ en línea o $$...$$ en bloque. NUNCA uses \( \) ni \[ \], porque se rompen al renderizar.
"""


class HistoryItem(BaseModel):
    role: str
    content: Optional[str] = ""


class ChatRequest(BaseModel):
    message: str
    history: Optional[List[HistoryItem]] = []
    image_base64: Optional[str] = None
    image_mime: Optional[str] = "image/jpeg"
    week: Optional[int] = None
    conversation_id: Optional[str] = None


class ChatResponse(BaseModel):
    response: str
    conversation_id: Optional[str] = None


def get_current_user(authorization: Optional[str] = Header(None)):
    """Devuelve el usuario de Supabase si viene un JWT valido en el header
    Authorization, o None (modo invitado) si no hay sesion. Nunca lanza error:
    un token invalido simplemente se trata como invitado."""
    if not authorization or not supabase:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    try:
        result = supabase.auth.get_user(parts[1].strip())
        return result.user if result else None
    except Exception:
        return None


def ensure_conversation(user_id: str, conversation_id: Optional[str], title_hint: str) -> str:
    if conversation_id:
        owner = supabase.table("conversations").select("user_id").eq("id", conversation_id).execute()
        if owner.data and owner.data[0]["user_id"] == user_id:
            return conversation_id
    title = title_hint.strip()[:40] or "Nueva conversación"
    if len(title_hint.strip()) > 40:
        title += "..."
    created = supabase.table("conversations").insert({"user_id": user_id, "title": title}).execute()
    return created.data[0]["id"]


def save_message(conversation_id: str, role: str, content: str, attachment_type: Optional[str] = None):
    supabase.table("messages").insert({
        "conversation_id": conversation_id,
        "role": role,
        "content": content,
        "attachment_type": attachment_type,
    }).execute()
    supabase.table("conversations").update({
        "updated_at": datetime.now(timezone.utc).isoformat()
    }).eq("id", conversation_id).execute()


def detect_week(message: str) -> Optional[int]:
    match = WEEK_PATTERN.search(message)
    return int(match.group(1)) if match else None


def retrieve_context(message: str, week: Optional[int]) -> str:
    if not supabase:
        return "Sin contexto relevante."
    try:
        query_embedding = embeddings.embed_query(message)
        result = supabase.rpc(
            "match_document_chunks",
            {
                "query_embedding": query_embedding,
                "match_count": 4,
                "filter_week": week,
            },
        ).execute()
        chunks = result.data or []
        if not chunks:
            return "Sin contexto relevante."
        return "\n\n".join(c["content"] for c in chunks)
    except Exception:
        print("Error consultando Supabase pgvector:")
        traceback.print_exc()
        return "Sin contexto relevante."


def format_history(history: List[HistoryItem]) -> str:
    lines = []
    for item in history[-4:]:
        role_label = "Usuario" if item.role == "user" else "Asistente"
        if item.content:
            lines.append(f"{role_label}: {item.content}")
    return "\n".join(lines) if lines else "Sin interacción previa."


@app.get("/")
def read_root():
    return {"status": "Finx API funcionando correctamente"}


@app.get("/sources")
def get_sources():
    if not supabase:
        raise HTTPException(status_code=503, detail="Supabase no configurado.")
    result = supabase.table("course_weeks").select("*").order("week_number").execute()
    return result.data


@app.post("/chat", response_model=ChatResponse)
def chat_endpoint(request: ChatRequest, current_user=Depends(get_current_user)):
    user_message = request.message.strip()
    if not user_message and not request.image_base64:
        raise HTTPException(status_code=400, detail="El mensaje no puede estar vacío.")

    conversation_id = None
    if current_user:
        conversation_id = ensure_conversation(
            current_user.id, request.conversation_id, user_message or "Imagen adjunta"
        )
        save_message(
            conversation_id,
            "user",
            user_message or "(imagen adjunta)",
            attachment_type="image" if request.image_base64 else None,
        )

    try:
        week = request.week or detect_week(user_message)
        context_text = retrieve_context(user_message or "imagen adjunta", week)
        formatted_history = format_history(request.history or [])

        prompt_text = f"""Contexto:
{context_text}

Historial de conversación:
{formatted_history}

Pregunta actual del usuario: {user_message or '(el usuario adjuntó una imagen sin texto adicional)'}"""

        if request.image_base64:
            human_content = [
                {"type": "text", "text": prompt_text},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{request.image_mime};base64,{request.image_base64}"},
                },
            ]
            messages = [SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=human_content)]
            ai_response = vision_llm.invoke(messages)
        else:
            messages = [SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=prompt_text)]
            ai_response = llm.invoke(messages)

        response_text = (
            str(ai_response.content) if ai_response and hasattr(ai_response, "content") else "No se pudo generar respuesta."
        )

        if current_user and conversation_id:
            save_message(conversation_id, "assistant", response_text)

        return ChatResponse(response=response_text, conversation_id=conversation_id)

    except Exception:
        print("\nERROR EN EL SERVIDOR:")
        traceback.print_exc()
        return ChatResponse(
            response="Hubo un inconveniente al procesar tu consulta. Por favor, intenta de nuevo.",
            conversation_id=conversation_id,
        )


@app.get("/conversations")
def list_conversations(current_user=Depends(get_current_user)):
    if not current_user:
        raise HTTPException(status_code=401, detail="Se requiere iniciar sesión.")
    result = (
        supabase.table("conversations")
        .select("id, title, updated_at")
        .eq("user_id", current_user.id)
        .order("updated_at", desc=True)
        .execute()
    )
    return result.data


@app.get("/conversations/{conversation_id}/messages")
def get_conversation_messages(conversation_id: str, current_user=Depends(get_current_user)):
    if not current_user:
        raise HTTPException(status_code=401, detail="Se requiere iniciar sesión.")
    owner = supabase.table("conversations").select("user_id").eq("id", conversation_id).execute()
    if not owner.data or owner.data[0]["user_id"] != current_user.id:
        raise HTTPException(status_code=404, detail="Conversación no encontrada.")
    result = (
        supabase.table("messages")
        .select("role, content, attachment_type, created_at")
        .eq("conversation_id", conversation_id)
        .order("created_at")
        .execute()
    )
    return result.data


@app.delete("/conversations/{conversation_id}")
def delete_conversation(conversation_id: str, current_user=Depends(get_current_user)):
    if not current_user:
        raise HTTPException(status_code=401, detail="Se requiere iniciar sesión.")
    owner = supabase.table("conversations").select("user_id").eq("id", conversation_id).execute()
    if not owner.data or owner.data[0]["user_id"] != current_user.id:
        raise HTTPException(status_code=404, detail="Conversación no encontrada.")
    supabase.table("conversations").delete().eq("id", conversation_id).execute()
    return {"status": "deleted"}


@app.post("/transcribe")
async def transcribe_endpoint(file: UploadFile = File(...)):
    if not groq_audio_client:
        raise HTTPException(status_code=503, detail="Transcripción de audio no configurada.")
    try:
        audio_bytes = await file.read()
        transcription = groq_audio_client.audio.transcriptions.create(
            file=(file.filename or "audio.webm", audio_bytes),
            model=GROQ_WHISPER_MODEL,
            language="es",
        )
        return {"text": transcription.text}
    except Exception:
        print("\nERROR TRANSCRIBIENDO AUDIO:")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="No se pudo transcribir el audio.")
