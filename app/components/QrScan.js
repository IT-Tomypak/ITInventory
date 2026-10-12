"use client";
// "Scan QR": a live camera view that processes the first QR code it sees,
// then hands the form the fields it found (lib/hardwareImport.js parseQr).
// Decodes with the browser's BarcodeDetector where it exists (Android/macOS
// Chrome), else jsQR (iPhone, Windows). "Take photo instead" covers no live
// camera (plain http, permission refused) and labels the live view misses.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, QrCode, X } from "lucide-react";
import { parseQr } from "../../lib/hardwareImport";
import { toast } from "./ui";

// Reads one frame (a <video>) or one photo (an ImageBitmap). Returns the text or null.
async function decode(source, width, height, ctx) {
  if ("BarcodeDetector" in window) {
    const [hit] = await new window.BarcodeDetector().detect(source).catch(() => []);
    return hit?.rawValue ?? null;
  }
  const scale = Math.min(1, 1000 / Math.max(width, height));
  const w = Math.round(width * scale), h = Math.round(height * scale);
  ctx.canvas.width = w; ctx.canvas.height = h;
  ctx.drawImage(source, 0, 0, w, h);
  const { default: jsQR } = await import("jsqr");
  return jsQR(ctx.getImageData(0, 0, w, h).data, w, h)?.data ?? null;
}
const canvasCtx = () => document.createElement("canvas").getContext("2d", { willReadFrequently: true });

// onScan(fields): only the fields this form has are applied by the caller.
// onExisting(serial): true when the page found that serial and showed it instead.
export default function QrScan({ onScan, onExisting }) {
  const [open, setOpen] = useState(false);
  const video = useRef(null);

  function handle(text) {
    setOpen(false);
    const fields = parseQr(text);
    if (fields.serial_no && onExisting?.(fields.serial_no)) return;
    onScan(fields);
    toast.success(`Scanned: ${Object.values(fields).join(", ")}`);
  }

  useEffect(() => {
    if (!open) return;
    let stopped = false, stream, timer;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      } catch (err) {
        if (!stopped) toast.error(`Live camera unavailable (${err.message}). Use "Take photo instead".`);
        return;
      }
      if (stopped) return stream.getTracks().forEach((t) => t.stop());
      const v = video.current, ctx = canvasCtx();
      v.srcObject = stream;
      await v.play().catch(() => {});
      const tick = async () => {
        if (stopped) return;
        const text = v.videoWidth ? await decode(v, v.videoWidth, v.videoHeight, ctx) : null;
        if (stopped) return;
        if (text) { stopped = true; handle(text); } else timer = setTimeout(tick, 200);
      };
      tick();
    })();
    return () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pickPhoto(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const img = await createImageBitmap(file);
      const text = await decode(img, img.width, img.height, canvasCtx());
      if (text) handle(text);
      else toast.error("No QR code found. Try again closer, with the label flat and in focus.");
    } catch (err) {
      toast.error("Could not read the photo: " + err.message);
    }
  }

  const photoInput = (cls, label) => (
    <label className={cls}>
      <Camera className="h-4 w-4" /> {label}
      <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={pickPhoto} />
    </label>
  );
  const btn = "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:border-brand";

  // No camera API at all (plain http): the photo route is the only one.
  if (typeof navigator !== "undefined" && !navigator.mediaDevices?.getUserMedia) return photoInput(btn, "Scan QR");

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btn}><QrCode className="h-4 w-4" /> Scan QR</button>
      {open && createPortal(
        <div role="dialog" aria-modal="true" aria-label="Scan QR code"
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-black/90 p-4">
          <div className="relative w-full max-w-md overflow-hidden rounded-xl">
            <video ref={video} playsInline muted className="block w-full" />
            <div className="pointer-events-none absolute inset-[15%] rounded-xl border-2 border-white/80" />
          </div>
          <p className="text-sm text-white/80">Point the camera at the QR code. It is read automatically.</p>
          <div className="flex gap-2">
            {photoInput("inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/40 px-3 py-2 text-sm text-white", "Take photo instead")}
            <button type="button" onClick={() => setOpen(false)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-medium text-black">
              <X className="h-4 w-4" /> Cancel
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
