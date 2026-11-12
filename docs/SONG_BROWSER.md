# Song browser setup

The Song browser (`songs.html`) lets visitors listen to songs, like them, report them and upload their own.
The site is static (GitHub Pages), so shared uploads need a small backend. Bandy uses [Supabase](https://supabase.com) — a free project is plenty — through plain `fetch` calls (no SDK, no build step).

Until you configure it, the page runs in **demo mode**: uploads are stored in the visitor's own browser (IndexedDB) and nothing is shared.

## 1. Create the Supabase project

1. Sign up at <https://supabase.com> and create a new project (any region, note the database password).
2. Open **SQL Editor → New query**, paste the whole of [`supabase/schema.sql`](../supabase/schema.sql) and press **Run**. It is safe to run again.
   This creates the `songs`, `likes` and `reports` tables, locks them down with Row Level Security, adds triggers (like counts, auto-hide on reports, upload rate limit) and creates a public `songs` storage bucket (20 MB limit, audio types only).

## 2. Configure sign-in

Uploads, likes and reports need a signed-in user; listening does not. Bandy uses passwordless email (a magic link, or a 6-digit code).

1. **Authentication → URL Configuration**: set **Site URL** to your site, e.g. `https://ahpah-dev.github.io/bandy/songs.html`, and add the same URL (and `http://127.0.0.1:5173/songs.html` for local testing) under **Redirect URLs**.
2. **Authentication → Providers → Email**: keep it enabled. Optional: turn off *Confirm email* is not needed — magic links already confirm the address.
3. Optional: in **Authentication → Email Templates → Magic Link**, add `{{ .Token }}` to the message so users can also type a 6-digit code instead of clicking the link.
4. Supabase's built-in mailer has a low hourly email limit. For a real launch, add your own SMTP server in **Project Settings → Authentication → SMTP**.

## 3. Connect Bandy

In **Project Settings → API** copy the **Project URL** and the **anon public** key into [`js/site/config.js`](../js/site/config.js):

```js
export const SUPABASE = {
  url: 'https://YOUR-PROJECT.supabase.co',
  anonKey: 'YOUR-ANON-PUBLIC-KEY',
};
```

Commit and push. The anon key is meant to be public; what protects your data is Row Level Security (already set up by the schema). **Never** put the `service_role` key anywhere in this repo.

## Rules built into the schema

| Rule | Where |
| --- | --- |
| Audio only: MP3, WAV, OGG, M4A, AAC, FLAC | storage bucket + `songs.mime` check |
| Max 20 MB per file | storage bucket + `songs.file_size` check |
| Uploader must confirm they hold the rights | `songs.rights_confirmed` check |
| Title ≤ 80, artist ≤ 60, description ≤ 500 characters | table checks |
| Max 5 uploads per user per day | `limit_uploads` trigger (and `LIMITS.maxUploadsPerDay` for the message) |
| Users can only upload into their own folder, edit and delete their own songs | RLS policies |
| Clients cannot write play/like/report counters or `hidden` | column-level grants + security-definer functions |
| A song is hidden after 3 reports | `count_report` trigger |

## Moderation

Reported songs are hidden from the public list automatically. Review them in **Table Editor → songs** (filter `hidden = true`) or with SQL:

```sql
-- hidden songs awaiting review
select id, title, artist, reports from public.songs where hidden order by reports desc;
-- restore after review
update public.songs set hidden = false, reports = 0 where id = '<song id>';
-- remove for good (also delete the file from Storage → songs)
delete from public.songs where id = '<song id>';
```

Hidden songs are removed from lists and search, but the audio file stays reachable by its direct URL until you delete it from Storage.

## Legal reminder

Public uploads mean you host user content. Decide how you will handle takedown requests (for example, a contact email in the site footer), and consider adding terms of use. Bandy ships with a rights confirmation on upload and a report button, which are a baseline, not legal advice.

## Local development

`python tools/serve.py` serves the site at <http://127.0.0.1:5173>. With an empty `config.js` the Song browser is in demo mode; with your Supabase keys it talks to your project (add `http://127.0.0.1:5173/songs.html` to the Redirect URLs).
