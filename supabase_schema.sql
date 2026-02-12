-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- PROFILES (Extends auth.users)
create table public.profiles (
  id uuid references auth.users not null primary key,
  username text unique not null,
  remark text, -- 真实姓名/班级
  token_key uuid default uuid_generate_v4() unique,
  invited_by uuid references public.profiles(id),
  tokens int default 20,
  last_token_update timestamptz default now(),
  is_banned boolean default false,
  
  constraint username_length check (char_length(username) >= 3)
);

-- INVITE CODES
create table public.invite_codes (
  code text primary key,
  created_by uuid references public.profiles(id) not null,
  used_by uuid references public.profiles(id), -- Null until used
  created_at timestamptz default now()
);

-- PIXELS (Canvas State)
-- Option: Use a single large JSONB for performance, or rows for queryability. 
-- For a school project, rows are fine and easier to query "who drew this".
create table public.pixels (
  x int not null,
  y int not null,
  color text not null,
  last_user uuid references public.profiles(id),
  updated_at timestamptz default now(),
  
  primary key (x, y)
);

-- RLS POLICIES (Row Level Security)
alter table public.profiles enable row level security;
alter table public.invite_codes enable row level security;
alter table public.pixels enable row level security;

-- Profiles: Public read (for leaderboard/checking names), Self update
create policy "Public profiles are viewable by everyone" on public.profiles
  for select using (true);

create policy "Users can update own profile" on public.profiles
  for update using (auth.uid() = id);

-- Invite Codes: Creator can view, User can view if they created or used it
create policy "View own invite codes" on public.invite_codes
  for select using (auth.uid() = created_by or auth.uid() = used_by);

-- Pixels: Everyone can view, Authenticated can update (via API logic usually, but here RLS for safety)
create policy "Pixels are viewable by everyone" on public.pixels
  for select using (true);
  
-- FUNCTIONS

-- Function to handle new user signup (Trigger)
create or replace function public.handle_new_user() 
returns trigger as $$
begin
  insert into public.profiles (id, username, remark)
  values (new.id, new.raw_user_meta_data->>'username', new.raw_user_meta_data->>'remark');
  return new;
end;
$$ language plpgsql security definer;

-- Trigger to create profile on signup
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
