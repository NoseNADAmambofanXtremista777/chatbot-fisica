-- Finx - escritura atomica de mensajes (ACID)
--
-- Antes, el backend hacia esto en pasos sueltos desde Python:
--   1) verificar/crear la conversacion
--   2) insertar el mensaje
--   3) actualizar conversations.updated_at
-- Cada paso era una llamada HTTP distinta a PostgREST: si el proceso se
-- caia entre el paso 1 y el 2, quedaba una conversacion vacia huerfana;
-- si se caia entre el 2 y el 3, el mensaje quedaba guardado pero la lista
-- de chats no reflejaba el orden real. Esta funcion hace los tres pasos
-- dentro de una sola transaccion de Postgres: o se guardan los tres, o no
-- se guarda nada (atomicidad real, no solo "en la mayoria de los casos").

create or replace function send_message(
    p_user_id uuid,
    p_conversation_id uuid,
    p_title_hint text,
    p_role text,
    p_content text,
    p_attachment_type text default null
)
returns uuid
language plpgsql
as $$
declare
    v_conversation_id uuid;
    v_title text;
begin
    if p_conversation_id is not null then
        select id into v_conversation_id
        from conversations
        where id = p_conversation_id and user_id = p_user_id
        for update;
    end if;

    if v_conversation_id is null then
        v_title := nullif(left(trim(coalesce(p_title_hint, '')), 40), '');
        if v_title is null then
            v_title := 'Nueva conversacion';
        elsif length(trim(p_title_hint)) > 40 then
            v_title := v_title || '...';
        end if;

        insert into conversations (user_id, title)
        values (p_user_id, v_title)
        returning id into v_conversation_id;
    end if;

    insert into messages (conversation_id, role, content, attachment_type)
    values (v_conversation_id, p_role, p_content, p_attachment_type);

    update conversations
    set updated_at = now()
    where id = v_conversation_id;

    return v_conversation_id;
end;
$$;
