// Song browser configuration.
//
// To let visitors share songs with each other, create a free Supabase project, run supabase/schema.sql
// in its SQL editor, then paste the Project URL and the "anon public" key below
// (see docs/SONG_BROWSER.md). The anon key is public by design - Row Level Security in the schema
// is what protects the data. Leave both empty to run the Song browser in local demo mode.
export const SUPABASE = {
  url: '',
  anonKey: '',
};

export const LIMITS = {
  maxBytes: 20 * 1024 * 1024,
  maxUploadsPerDay: 5,
  // extension -> mime type accepted by the storage bucket
  types: { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac' },
  genres: ['Electronic', 'Hip Hop', 'Lo-Fi', 'Pop', 'Rock', 'R&B', 'Ambient', 'Jazz', 'Folk', 'Cinematic', 'Other'],
};
