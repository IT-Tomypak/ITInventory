// Photos are stored as newline-separated public URLs in ONE text column — no
// join table. One read, one write, trivially exportable to CSV. Splitting on
// commas too keeps legacy comma-separated values readable.
import { supabase } from "./supabaseClient";

export const splitPhotos = (value) => (value || "").split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
export const joinPhotos = (urls) => urls.filter(Boolean).join("\n") || null;

// Uploads to the public-read `attachments` bucket and returns the public URL.
export async function uploadPhoto(file, folder) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from("attachments").upload(path, file, { contentType: file.type });
  if (error) throw error;
  return supabase.storage.from("attachments").getPublicUrl(path).data.publicUrl;
}
