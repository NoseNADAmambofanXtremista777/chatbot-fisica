import os
import re
import shutil
from typing import Dict, List, Optional

from dotenv import load_dotenv
from langchain_core.documents import Document
from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from pptx import Presentation
from supabase import create_client

load_dotenv()

DOCS_DIR = "documentos"
LEGACY_CHROMA_PATH = "chroma_db"

# Tolera "SEMANA 07 -", "SEMANA 10_", "SEMANA_11_", "SEMANA 1_", etc.
WEEK_PATTERN = re.compile(r"SEMANA[\s_]*0*(\d{1,2})", re.IGNORECASE)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY")

# UUID que nunca existe, usado para poder hacer "delete all" vía filtro (la API
# de PostgREST exige al menos un filtro en los delete).
_NIL_UUID = "00000000-0000-0000-0000-000000000000"


def extract_week(filename: str) -> Optional[int]:
    match = WEEK_PATTERN.search(filename)
    return int(match.group(1)) if match else None


def load_pptx(path: str) -> List[Document]:
    """Extrae el texto de cada diapositiva de un .pptx como un Document separado."""
    presentation = Presentation(path)
    docs: List[Document] = []
    for i, slide in enumerate(presentation.slides, start=1):
        texts = []
        for shape in slide.shapes:
            if shape.has_text_frame:
                text = shape.text_frame.text.strip()
                if text:
                    texts.append(text)
            if shape.has_table:
                for row in shape.table.rows:
                    row_text = " | ".join(cell.text.strip() for cell in row.cells)
                    if row_text.strip(" |"):
                        texts.append(row_text)
        slide_text = "\n".join(texts).strip()
        if slide_text:
            docs.append(Document(page_content=slide_text, metadata={"source": path, "slide": i}))
    return docs


def load_documents() -> List[Document]:
    documents: List[Document] = []
    if not os.path.isdir(DOCS_DIR):
        print(f"No existe la carpeta '{DOCS_DIR}'.")
        return documents

    for name in sorted(os.listdir(DOCS_DIR)):
        path = os.path.join(DOCS_DIR, name)
        if not os.path.isfile(path):
            continue
        lower = name.lower()
        try:
            if lower.endswith(".pdf"):
                documents.extend(PyPDFLoader(path).load())
            elif lower.endswith(".pptx"):
                documents.extend(load_pptx(path))
            elif lower.endswith(".txt"):
                documents.extend(TextLoader(path, encoding="utf-8").load())
        except Exception as e:
            print(f"  ! No se pudo procesar '{name}': {e}")

    return documents


def build_vector_store():
    if not SUPABASE_URL or not SUPABASE_SECRET_KEY:
        raise RuntimeError(
            "Faltan SUPABASE_URL / SUPABASE_SECRET_KEY en el .env. "
            "Corre primero la migracion de supabase/migrations/0001_init.sql."
        )

    supabase = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)

    print("Cargando documentos de la carpeta 'documentos' (pdf, pptx, txt)...")
    raw_documents = load_documents()
    if not raw_documents:
        print("No se encontraron documentos para procesar.")
        return
    print(f"  -> {len(raw_documents)} paginas/diapositivas cargadas.")

    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    chunks = text_splitter.split_documents(raw_documents)
    print(f"Se crearon {len(chunks)} fragmentos de texto.")

    print("Generando embeddings con HuggingFace (all-MiniLM-L6-v2)...")
    embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
    vectors = embeddings.embed_documents([c.page_content for c in chunks])

    print("Limpiando 'document_chunks' y 'documents' anteriores en Supabase...")
    supabase.table("document_chunks").delete().neq("id", _NIL_UUID).execute()
    supabase.table("documents").delete().neq("id", _NIL_UUID).execute()

    print("Registrando documentos fuente...")
    document_ids: Dict[str, str] = {}
    for chunk in chunks:
        source = chunk.metadata.get("source", "desconocido")
        if source in document_ids:
            continue
        filename = os.path.basename(source)
        week = extract_week(filename)
        if week is None:
            print(f"  ! No se pudo detectar la semana de '{filename}', se indexa sin semana asociada.")
        result = supabase.table("documents").insert({
            "week_number": week,
            "filename": filename,
            "storage_path": source,
        }).execute()
        document_ids[source] = result.data[0]["id"]

    print("Subiendo fragmentos + embeddings a Supabase pgvector...")
    rows = []
    for chunk, vector in zip(chunks, vectors):
        source = chunk.metadata.get("source", "desconocido")
        filename = os.path.basename(source)
        week = extract_week(filename)
        rows.append({
            "document_id": document_ids[source],
            "week_number": week,
            "content": chunk.page_content,
            "embedding": vector,
        })

    batch_size = 100
    for i in range(0, len(rows), batch_size):
        supabase.table("document_chunks").insert(rows[i:i + batch_size]).execute()

    print(f"Listo. {len(rows)} fragmentos indexados en Supabase para {len(document_ids)} documentos.")

    if os.path.exists(LEGACY_CHROMA_PATH):
        shutil.rmtree(LEGACY_CHROMA_PATH)
        print("Carpeta 'chroma_db' local (legado de Chroma) eliminada.")


if __name__ == "__main__":
    build_vector_store()
