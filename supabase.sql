-- ============================================================================
--  Writing Test Taker — Supabase schema
--  Run this once in your Supabase project:  SQL Editor -> New query -> paste ->
--  Run.  It creates the two tables and locks them down so ONLY the server
--  (service-role key) can read/write them. No browser can touch them directly.
-- ============================================================================

-- Tasks: a single row (id = 1) holding the two published prompts.
create table if not exists public.tasks (
  id          int primary key,
  task1_text  text default '',
  task1_image text,
  task2_text  text default '',
  task2_image text,
  updated_at  timestamptz default now()
);

insert into public.tasks (id, task1_text, task2_text)
values (1,
        'TASK 1 (recommended 20 minutes) — the teacher can replace this on the teacher page.',
        'TASK 2 (recommended 40 minutes) — the teacher can replace this on the teacher page.')
on conflict (id) do nothing;

-- Submissions: one row per finished test.
create table if not exists public.submissions (
  id          bigint generated always as identity primary key,
  first_name  text,
  last_name   text,
  status      text,          -- 'completed' | 'cheated'
  reason      text,          -- why the test ended early (if cheated)
  phase       text,          -- 'task1' | 'task2' | 'finished'
  task1_text  text,
  task2_text  text,
  task1_words int default 0,
  task2_words int default 0,
  started_at  timestamptz,
  ended_at    timestamptz default now()
);

-- Row-Level Security ON with NO policies => the public "anon" key that would be
-- exposed in a browser can read/write NOTHING here. Only the service-role key
-- used by the server functions bypasses RLS. This is what keeps student
-- browsers away from teacher data.
alter table public.tasks       enable row level security;
alter table public.submissions enable row level security;
