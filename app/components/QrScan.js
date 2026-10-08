"use client";
// "Scan QR": take a photo of a label, decode it, hand the form the fields it
// found (lib/hardwareImport.js parseQr). Uses the browser's BarcodeDetector
// where it exists (Android/macOS Chrome), else jsQR (iPhone, Windows).
import { QrCode } from "lucide-react";
import { parseQr } from "../../lib/hardwareImport";
import { toast } from "./ui";

async function decode(file) {
  const img = await createImageBitmap(file);
  if ("BarcodeDetector" in window) {
    const [hit] = await new window.BarcodeDetector().detect(img).catch(() => []);
    if (hit) return hit.rawValue;
  }
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const { default: jsQR } = await import("jsqr");
  return jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height)?.data ?? null;
}

// onScan(fields): only the fields this form has are applied by the caller.
// onExisting(serial): true when the page found that serial and showed it instead.
export default function QrScan({ onScan, onExisting }) {
  async function pick(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await decode(file);
      if (!text) return toast.error("No QR code found. Try again closer, with the label flat and in focus.");
      const fields = parseQr(text);
      if (fields.serial_no && onExisting?.(fields.serial_no)) return;
      onScan(fields);
      toast.success(`Scanned: ${Object.values(fields).join(", ")}`);
    } catch (err) {
      toast.error("Could not read the photo: " + err.message);
    }
  }
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:border-brand">
      <QrCode className="h-4 w-4" /> Scan QR
      <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={pick} />
    </label>
  );
}
