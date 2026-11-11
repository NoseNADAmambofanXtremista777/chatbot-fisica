import os
import shutil
from langchain_community.document_loaders import DirectoryLoader, PyPDFLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma

DOCS_DIR = "documentos"
CHROMA_PATH = "chroma_db"

def build_vector_store():
    documents = []

    # 1. Cargar archivos PDF de la carpeta 'documentos'
    if os.path.exists(DOCS_DIR):
        print("📄 Cargando archivos PDF...")
        pdf_loader = DirectoryLoader(DOCS_DIR, glob="**/*.pdf", loader_cls=PyPDFLoader)
        pdf_docs = pdf_loader.load()
        documents.extend(pdf_docs)
        print(f"  -> Se encontraron {len(pdf_docs)} páginas/documentos en PDF.")

        # Cargar archivos TXT dentro de 'documentos'
        txt_loader = DirectoryLoader(DOCS_DIR, glob="**/*.txt", loader_cls=TextLoader)
        txt_docs = txt_loader.load()
        documents.extend(txt_docs)

    # 2. Cargar 'conocimiento.txt' si existe en la raíz
    if os.path.exists("conocimiento.txt"):
        print("📄 Cargando conocimiento.txt...")
        loader = TextLoader("conocimiento.txt", encoding="utf-8")
        documents.extend(loader.load())

    if not documents:
        print("⚠️ No se encontraron documentos PDF ni TXT para procesar.")
        return

    # 3. Dividir los textos en fragmentos (chunks)
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    chunks = text_splitter.split_documents(documents)
    print(f"🧩 Se crearon {len(chunks)} fragmentos de texto.")

    # 4. Limpiar la base de datos anterior si existe
    if os.path.exists(CHROMA_PATH):
        shutil.rmtree(CHROMA_PATH)
        print("🧹 Base de datos antigua eliminada.")

    # 5. Crear Embeddings con HuggingFace (Local y Gratis)
    print("🧠 Generando vectores con HuggingFace (all-MiniLM-L6-v2)...")
    embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

    # 6. Guardar en la carpeta chroma_db
    vector_store = Chroma.from_documents(
        documents=chunks,
        embedding=embeddings,
        persist_directory=CHROMA_PATH
    )
    print("✅ ¡Base de datos vectorial (chroma_db) creada exitosamente!")

if __name__ == "__main__":
    build_vector_store()