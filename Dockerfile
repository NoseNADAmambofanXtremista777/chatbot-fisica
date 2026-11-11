FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Solo el servicio web viaja en la imagen. ingest.py (que necesita la carpeta
# documentos/) se corre localmente contra Supabase, no dentro de este contenedor.
COPY main.py ./

EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
