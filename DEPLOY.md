# Despliegue de Finx

Esta guía asume que el desarrollo local ya funciona (backend en `http://127.0.0.1:8000`,
frontend en `http://localhost:5173`). Cuando actives las cuentas de Fly.io y/o
Cloudflare, sigue estos pasos en orden — son prácticamente copiar y pegar.

## 0. Antes de empezar

- `flyctl` ya está instalado en esta máquina en `C:\Users\<tu usuario>\.fly\bin\flyctl.exe`
  (abre una terminal nueva para que el PATH lo reconozca como `flyctl` directo).
- `wrangler` (CLI de Cloudflare) no necesita instalación global: se usa con `npx wrangler ...`.
- Docker **no** está instalado en esta máquina. No es obligatorio para desplegar
  (Fly.io puede construir la imagen por ti con `fly deploy` usando buildpacks remotos
  a partir del `Dockerfile`), pero si quieres probar la imagen localmente antes de
  desplegar, instala Docker Desktop primero.

## 1. Backend en Fly.io

1. Crea una cuenta en [fly.io](https://fly.io) (pide tarjeta para habilitar el uso,
   aunque el plan "Hobby" tiene una asignación gratuita mensual).
2. Inicia sesión desde la terminal:
   ```bash
   flyctl auth login
   ```
3. Desde la carpeta del proyecto (`chatbot_proyecto/`), crea la app (usa el `fly.toml`
   que ya existe, solo confirma nombre/región o ajústalos):
   ```bash
   flyctl launch --no-deploy
   ```
   Si te pregunta si quieres usar el `fly.toml` existente, di que sí. Si el nombre
   `finx-backend` ya está tomado, Fly te dejará elegir otro (actualiza el campo `app`
   en `fly.toml` para que coincida).
4. Carga los secretos (nunca van en `fly.toml` ni al repo):
   ```bash
   flyctl secrets set GROQ_API_KEY=tu_groq_api_key
   flyctl secrets set SUPABASE_URL=https://bixeyfukhdonkpdefxft.supabase.co
   flyctl secrets set SUPABASE_SECRET_KEY=tu_service_role_key
   flyctl secrets set CORS_ORIGINS=https://finx.pages.dev
   ```
   (Ajusta `CORS_ORIGINS` al dominio real que te dé Cloudflare Pages en el paso 2;
   puedes separar varios orígenes con comas.)
5. Despliega:
   ```bash
   flyctl deploy
   ```
6. Verifica que responde:
   ```bash
   curl https://<tu-app>.fly.dev/
   ```
   Deberías ver `{"status":"Finx API funcionando correctamente"}`.

Notas:
- `ingest.py` **no** se ejecuta dentro del contenedor desplegado (no viaja la carpeta
  `documentos/`). Sigue corriéndolo localmente contra Supabase cuando agregues
  material nuevo (semanas 14, 15, etc.) — ya escribe directo a la base de datos,
  así que el backend desplegado lo ve de inmediato sin necesidad de redeploy.
- Revisa logs con `flyctl logs`.

## 2. Frontend en Cloudflare Pages

Dos formas; la más simple es la línea de comandos con `wrangler` (no requiere
conectar GitHub). Necesitas una cuenta gratuita en [cloudflare.com](https://dash.cloudflare.com/sign-up)
(sin tarjeta para Pages).

1. Antes de compilar, apunta el frontend al backend ya desplegado en Fly.io:
   edita `frontend/.env` (o crea `frontend/.env.production`) con:
   ```
   VITE_API_BASE_URL=https://<tu-app>.fly.dev
   VITE_SUPABASE_URL=https://bixeyfukhdonkpdefxft.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=tu_publishable_key
   ```
2. Compila:
   ```bash
   cd frontend
   npm run build
   ```
3. Inicia sesión en Cloudflare desde la terminal (abre el navegador para autorizar):
   ```bash
   npx wrangler login
   ```
4. Crea el proyecto de Pages (una sola vez) y sube el build:
   ```bash
   npx wrangler pages project create finx --production-branch=main
   npx wrangler pages deploy dist --project-name=finx
   ```
5. Wrangler te da una URL `https://finx.pages.dev` (o similar). Esa es la que debes
   poner en `CORS_ORIGINS` del backend (paso 1.4) y volver a desplegar el backend
   (`flyctl deploy`) para que acepte peticiones desde ahí.

Alternativa (deploy continuo automático): conecta el repo de GitHub del proyecto
desde el dashboard de Cloudflare Pages (Workers & Pages → Create → Pages → Connect
to Git), con "Build command" = `npm run build` y "Build output directory" = `dist`,
"Root directory" = `frontend`. Así cada `git push` redepliega solo. Esto requiere
que el repo esté subido a GitHub (hoy solo existe en git local).

## 3. Dominio propio (opcional, para después)

Ni Fly.io ni Cloudflare Pages necesitan dominio propio para funcionar (dan
subdominios gratis: `*.fly.dev` y `*.pages.dev`). Cuando compres un dominio,
en Cloudflare Pages es "Custom domains" → agregar dominio (Cloudflare ya es
DNS, así que es prácticamente automático); en Fly.io es `flyctl certs add tu-dominio.com`.

## 4. Cambiar de Groq a la API de Claude más adelante

La arquitectura ya quedó desacoplada: el único lugar que instancia el modelo de
chat es `llm = ChatGroq(...)` en `main.py`. Para migrar, se reemplaza esa
instancia por el cliente de Anthropic (`langchain-anthropic` o el SDK oficial)
y se ajusta la llamada en `chat_endpoint`; el resto del sistema (RAG, prompt,
persistencia, frontend) no cambia.
