// Reads a QR code from the camera (live) or from an uploaded photo. Uses jsQR on canvas frames.
import jsQR from "jsqr";
import { useEffect, useRef, useState } from "react";
import { Button, Input } from "./ui";

function decodeImageData(img: ImageData) {
  return jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" })?.data ?? null;
}

export function Scanner({ onResult, label = "Scan a QR code" }: { onResult: (text: string) => void; label?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<"idle" | "camera">("idle");
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const stream = useRef<MediaStream | null>(null);

  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setMode("idle");
  };
  useEffect(() => stop, []);

  const start = async () => {
    setError(null);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      setMode("camera");
      requestAnimationFrame(async () => {
        const v = video.current!;
        v.srcObject = stream.current;
        await v.play();
        tick();
      });
    } catch {
      setError("Camera not available here. Upload a photo of the QR instead, or paste its text.");
    }
  };

  const tick = () => {
    const v = video.current;
    const c = canvas.current;
    if (!v || !c || !stream.current) return;
    if (v.readyState === v.HAVE_ENOUGH_DATA) {
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(v, 0, 0);
      const text = decodeImageData(ctx.getImageData(0, 0, c.width, c.height));
      if (text) {
        stop();
        navigator.vibrate?.(60);
        onResult(text);
        return;
      }
    }
    requestAnimationFrame(tick);
  };

  const fromFile = async (file: File) => {
    setError(null);
    const bmp = await createImageBitmap(file);
    const c = canvas.current!;
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const text = decodeImageData(ctx.getImageData(0, 0, c.width, c.height));
    if (text) onResult(text);
    else setError("No QR code found in that photo. Try a sharper, closer photo.");
  };

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-2xl border border-line bg-abyss" style={{ aspectRatio: mode === "camera" ? "4 / 3" : undefined }}>
        {mode === "camera" ? (
          <>
            <video ref={video} playsInline muted className="h-full w-full object-cover" />
            <div className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-mint/80 shadow-[0_0_0_9999px_rgba(1,22,26,0.45)]" />
            <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 animate-pulse bg-mint" />
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <div className="text-5xl">⌗</div>
            <div className="font-semibold">{label}</div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={start}>Use camera</Button>
              <label className="inline-flex cursor-pointer items-center rounded-xl border border-white/10 bg-white/8 px-4 py-2.5 text-sm font-semibold hover:bg-white/14">
                Upload photo
                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && fromFile(e.target.files[0])} />
              </label>
            </div>
          </div>
        )}
        <canvas ref={canvas} className="hidden" />
      </div>
      {mode === "camera" && (
        <Button variant="ghost" onClick={stop} className="w-full">
          Stop camera
        </Button>
      )}
      {error && <p className="text-sm text-amber">{error}</p>}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) onResult(manual.trim());
        }}
      >
        <Input placeholder="…or paste the code text / type a unit id" value={manual} onChange={(e) => setManual(e.target.value)} />
        <Button variant="soft" type="submit">
          Go
        </Button>
      </form>
    </div>
  );
}
