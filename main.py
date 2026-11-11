import os
import traceback
from typing import List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# LangChain, Chroma, Groq y HuggingFace
from langchain_chroma import Chroma
from langchain_groq import ChatGroq
from langchain_huggingface import HuggingFaceEmbeddings

app = FastAPI(title="Asistente Virtual de Física")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

# 1. Embeddings con HuggingFace (100% libre de cuotas y de Google)
embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

# 2. Modelo ultra rápido con Groq
llm = ChatGroq(
    model="llama-3.3-70b-versatile",
    temperature=0.3,
    groq_api_key=GROQ_API_KEY
)

# 3. Conectar con la carpeta chroma_db
CHROMA_PATH = "chroma_db"
try:
    vector_store = Chroma(persist_directory=CHROMA_PATH, embedding_function=embeddings)
    retriever = vector_store.as_retriever(search_kwargs={"k": 3})
except Exception as e:
    print(f"⚠️ Advertencia al cargar ChromaDB: {e}")
    retriever = None

# Schemas de FastAPI
class HistoryItem(BaseModel):
    role: str
    content: Optional[str] = ""

class ChatRequest(BaseModel):
    message: str
    history: Optional[List[HistoryItem]] = []

class ChatResponse(BaseModel):
    response: str

@app.get("/")
def read_root():
    return {"status": "API de Física con Groq y HuggingFace funcionando correctamente"}

@app.post("/chat", response_model=ChatResponse)
def chat_endpoint(request: ChatRequest):
    user_message = request.message.strip()
    if not user_message:
        raise HTTPException(status_code=400, detail="El mensaje no puede estar vacío.")
    
    try:
        # a. Buscar contexto en los PDFs/textos cargados
        context_text = "Sin contexto relevante."
        if retriever:
            docs = retriever.invoke(user_message)
            if docs:
                context_text = "\n\n".join([doc.page_content for doc in docs])
        
        # b. Historial
        formatted_history = ""
        if request.history:
            for item in request.history[-4:]:
                role_label = "Usuario" if item.role == "user" else "Asistente"
                content_text = item.content or ""
                if content_text:
                    formatted_history += f"{role_label}: {content_text}\n"
        
        if not formatted_history:
            formatted_history = "Sin interacción previa."

        # c. Prompt
        prompt_text = f"""Eres un asistente virtual chatbot del curso de física, amable, profesional y servicial.

INSTRUCCIONES DE RESPUESTA:
1. Utiliza el 'Contexto' como tu fuente PRINCIPAL de información para responder sobre el curso de física, temas, fórmulas y syllabus.
2. Si la pregunta del usuario no está en el 'Contexto' o es una consulta general (saludos, explicaciones complementarias), puedes responder con tu conocimiento general.
3. Sé claro, preciso y conciso.

Contexto:
{context_text}

Historial de Conversación:
{formatted_history}

Pregunta actual del usuario: {user_message}"""
        
        # d. Respuesta con Groq
        ai_response = llm.invoke(prompt_text)
        response_text = str(ai_response.content) if ai_response and hasattr(ai_response, 'content') else "No se pudo generar respuesta."

        return ChatResponse(response=response_text)

    except Exception as e:
        print("\n❌ ERROR EN EL SERVIDOR:")
        traceback.print_exc()
        return ChatResponse(
            response="Hubo un inconveniente al procesar tu consulta. Por favor, intenta de nuevo."
        )