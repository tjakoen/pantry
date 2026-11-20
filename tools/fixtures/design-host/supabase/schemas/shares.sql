create table public.documents (id uuid primary key, owner_id uuid not null references auth.users(id), title text not null);
create table public.shares (id uuid primary key, document_id uuid not null references public.documents(id) on delete cascade, token text not null, expires_at timestamptz);
