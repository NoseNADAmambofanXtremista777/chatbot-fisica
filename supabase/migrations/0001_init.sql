-- Finx - esquema inicial de Supabase
-- Requiere la extension pgvector ya activada en el proyecto.
create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- course_weeks: mapa fijo de las 16 semanas del curso y su estado.
-- ---------------------------------------------------------------------------
create table if not exists course_weeks (
    week_number int primary key check (week_number between 1 and 16),
    title text not null,
    status text not null check (status in ('content', 'exam', 'finals', 'pending'))
);

insert into course_weeks (week_number, title, status) values
    (1, 'Campo electrico y fuerza electrica', 'content'),
    (2, 'Potencial electrico', 'content'),
    (3, 'Capacidad electrica y condensadores', 'content'),
    (4, 'Corriente y circuitos', 'content'),
    (5, 'Corriente electrica, resistencia y ley de Ohm', 'content'),
    (6, 'Leyes de Kirchhoff', 'content'),
    (7, 'Circuitos transitorios RC', 'content'),
    (8, 'Semana de examen parcial', 'exam'),
    (9, 'Magnetismo: fuerza y campo magnetico', 'content'),
    (10, 'Campo magnetico - Biot-Savart', 'content'),
    (11, 'Ley de Faraday', 'content'),
    (12, 'Corriente alterna', 'content'),
    (13, 'Circuitos RLC', 'content'),
    (14, 'Pendiente de publicar', 'pending'),
    (15, 'Pendiente de publicar', 'pending'),
    (16, 'Examenes finales - cierre del curso', 'finals')
on conflict (week_number) do update
    set title = excluded.title,
        status = excluded.status;

-- ---------------------------------------------------------------------------
-- documents: un registro por archivo fuente ingerido.
-- ---------------------------------------------------------------------------
create table if not exists documents (
    id uuid primary key default gen_random_uuid(),
    week_number int references course_weeks(week_number),
    filename text not null,
    storage_path text,
    created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- document_chunks: fragmentos de texto + embedding (all-MiniLM-L6-v2, 384 dims).
-- ---------------------------------------------------------------------------
create table if not exists document_chunks (
    id uuid primary key default gen_random_uuid(),
    document_id uuid references documents(id) on delete cascade,
    week_number int references course_weeks(week_number),
    content text not null,
    embedding vector(384) not null,
    created_at timestamptz not null default now()
);

create index if not exists document_chunks_embedding_idx
    on document_chunks using ivfflat (embedding vector_cosine_ops)
    with (lists = 100);

create index if not exists document_chunks_week_idx
    on document_chunks (week_number);

-- Busqueda semantica con filtro opcional por semana. Usada desde main.py via RPC.
create or replace function match_document_chunks(
    query_embedding vector(384),
    match_count int default 4,
    filter_week int default null
)
returns table (
    id uuid,
    document_id uuid,
    week_number int,
    content text,
    similarity float
)
language sql stable
as $$
    select
        dc.id,
        dc.document_id,
        dc.week_number,
        dc.content,
        1 - (dc.embedding <=> query_embedding) as similarity
    from document_chunks dc
    where filter_week is null or dc.week_number = filter_week
    order by dc.embedding <=> query_embedding
    limit match_count;
$$;

-- ---------------------------------------------------------------------------
-- profiles: uno por usuario autenticado de Supabase Auth.
-- ---------------------------------------------------------------------------
create table if not exists profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text,
    created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- conversations / messages: historial persistente de usuarios registrados.
-- Los invitados no persisten aqui (se quedan en localStorage del navegador).
-- ---------------------------------------------------------------------------
create table if not exists conversations (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    title text not null default 'Nueva conversacion',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists messages (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references conversations(id) on delete cascade,
    role text not null check (role in ('user', 'assistant')),
    content text not null,
    attachment_type text check (attachment_type in ('image', 'audio')),
    attachment_path text,
    created_at timestamptz not null default now()
);

create index if not exists messages_conversation_idx on messages (conversation_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table course_weeks enable row level security;
alter table documents enable row level security;
alter table document_chunks enable row level security;
alter table profiles enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;

-- Material del curso: lectura publica (incluye invitados), escritura solo
-- desde el backend con la service role key (ingest.py), que ignora RLS.
create policy "course_weeks_public_read" on course_weeks
    for select using (true);
create policy "documents_public_read" on documents
    for select using (true);
create policy "document_chunks_public_read" on document_chunks
    for select using (true);

-- Perfiles y conversaciones: cada usuario ve y edita solo lo suyo.
create policy "profiles_select_own" on profiles
    for select using (auth.uid() = id);
create policy "profiles_upsert_own" on profiles
    for insert with check (auth.uid() = id);
create policy "profiles_update_own" on profiles
    for update using (auth.uid() = id);

create policy "conversations_all_own" on conversations
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "messages_all_own" on messages
    for all using (
        exists (
            select 1 from conversations c
            where c.id = messages.conversation_id and c.user_id = auth.uid()
        )
    ) with check (
        exists (
            select 1 from conversations c
            where c.id = messages.conversation_id and c.user_id = auth.uid()
        )
    );
