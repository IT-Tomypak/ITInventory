// Photos are stored as newline-separated public URLs in ONE text column — no
// join table. One read, one write, trivially exportable to CSV. Splitting on
// commas too keeps legacy comma-separated values readable.
import { supabase } from "./supabaseClient";

export const splitPhotos = (value) => (value || "").split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
export const joinPhotos = (urls) => urls.filter(Boolean).join("\n") || null;

// Uploads to the public-read `attachments` bucket and returns the public URL.
export async function uploadPhoto(original, folder) {
  const file = await shrinkImage(original);
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from("attachments").upload(path, file, { contentType: file.type });
  if (error) throw error;
  return supabase.storage.from("attachments").getPublicUrl(path).data.publicUrl;
}

// Phone photos are 3–6 MB; the email thumbnails and the register need ~1600px.
// Re-encoding to JPEG also turns HEIC into something every browser can show.
// Any failure falls back to the original file rather than losing the photo.
export async function shrinkImage(file, max = 1600, quality = 0.82) {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = Object.assign(document.createElement("canvas"), {
      width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale),
    });
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    return blob ? new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}
