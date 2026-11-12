// Song browser configuration.
//
// To let visitors share songs with each other, create a free Supabase project, run supabase/schema.sql
// in its SQL editor, then paste the Project URL and the "anon public" key below
// (see docs/SONG_BROWSER.md). The anon key is public by design - Row Level Security in the schema
// is what protects the data. Leave both empty to run the Song browser in local demo mode.
export const SUPABASE = {
  url: 'https://gxwjozroaibwbwpmsell.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4d2pvenJvYWlid2J3cG1zZWxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0ODY2MzQsImV4cCI6MjExMDA2MjYzNH0._X_1rbIvomvge6lzrA50ulsVetv7_x8nhE3zF3qIbeE',
};

export const LIMITS = {
  maxBytes: 20 * 1024 * 1024,
  maxUploadsPerDay: 5,
  // extension -> mime type accepted by the storage bucket
  types: { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac' },
  genres: ['Electronic', 'Hip Hop', 'Lo-Fi', 'Pop', 'Rock', 'R&B', 'Ambient', 'Jazz', 'Folk', 'Cinematic', 'Other'],
};
