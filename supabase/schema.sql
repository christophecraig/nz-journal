-- Carnet de bord : comptes (profils) et commentaires.
-- À coller une seule fois dans Supabase > SQL Editor > Run. Relançable sans risque.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  user_id uuid not null default auth.uid() references public.profiles (user_id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists comments_day_idx on public.comments (day, created_at);

alter table public.profiles enable row level security;
alter table public.comments enable row level security;

-- Lecture publique (les visiteurs non connectés voient les commentaires et les prénoms, jamais les e-mails)
drop policy if exists "profils lisibles" on public.profiles;
create policy "profils lisibles" on public.profiles for select using (true);
drop policy if exists "commentaires lisibles" on public.comments;
create policy "commentaires lisibles" on public.comments for select using (true);

-- Écriture : uniquement connecté, et uniquement pour soi
drop policy if exists "créer son profil" on public.profiles;
create policy "créer son profil" on public.profiles for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "modifier son profil" on public.profiles;
create policy "modifier son profil" on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "commenter" on public.comments;
create policy "commenter" on public.comments for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "supprimer son commentaire" on public.comments;
create policy "supprimer son commentaire" on public.comments for delete to authenticated using (user_id = auth.uid());

grant select on public.profiles, public.comments to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant insert, delete on public.comments to authenticated;

-- Anti-spam : 1 commentaire toutes les 10 secondes, 30 par jour et par personne
create or replace function public.comments_throttle() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.comments where user_id = new.user_id and created_at > now() - interval '10 seconds') then
    raise exception 'Trop rapide : attends quelques secondes avant de commenter à nouveau.';
  end if;
  if (select count(*) from public.comments where user_id = new.user_id and created_at > now() - interval '1 day') >= 30 then
    raise exception 'Limite de 30 commentaires par jour atteinte.';
  end if;
  return new;
end $$;

drop trigger if exists comments_throttle on public.comments;
create trigger comments_throttle before insert on public.comments
  for each row execute function public.comments_throttle();
