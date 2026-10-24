import QRCode from "qrcode";
import { useEffect, useState } from "react";

export const verifyUrl = (payload: string) => `${location.origin}/v#${payload}`;

export function QrImage({ text, size = 180, className = "" }: { text: string; size?: number; className?: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(text, { margin: 1, width: size * 2, errorCorrectionLevel: "M", color: { dark: "#011f22", light: "#ffffff" } }).then(setSrc);
  }, [text, size]);
  return src ? <img src={src} width={size} height={size} className={`rounded-lg bg-white p-1 ${className}`} alt="QR code" /> : <div style={{ width: size, height: size }} className="rounded-lg bg-white/10" />;
}

export async function qrDataUrl(text: string, size = 360) {
  return QRCode.toDataURL(text, { margin: 1, width: size, errorCorrectionLevel: "M" });
}
