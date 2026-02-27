// js/supabaseClient.js

const supabaseUrl = 'https://uaaravrwirbwwthpkvwu.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhYXJhdnJ3aXJid3d0aHBrdnd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3NzA5NjksImV4cCI6MjA3NTM0Njk2OX0.Dm1vnI5vq7QS16mX3uwl-JWwy_4v-oVtTf2SXYqQNW0';

// Explicitly use window.supabase (loaded from index.html) and export it
export const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);