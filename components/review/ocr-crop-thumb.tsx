"use client";

import { useEffect, useRef, useState } from "react";

type BBox = { x: number; y: number; w: number; h: number };

/**
 * Výřez stránky podle bbox z OCR (stejné pixely jako náhled stránky).
 */
export function OcrCropThumb({
  imageSrc,
  bbox,
  maxHeight = 64,
}: {
  imageSrc: string;
  bbox: BBox;
  maxHeight?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || bbox.w <= 0 || bbox.h <= 0) return;

    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const scale = maxHeight / bbox.h;
      const dw = Math.min(160, Math.max(40, bbox.w * scale));
      const dh = maxHeight;
      canvas.width = Math.round(dw);
      canvas.height = Math.round(dh);
      try {
        ctx.drawImage(
          img,
          bbox.x,
          bbox.y,
          bbox.w,
          bbox.h,
          0,
          0,
          canvas.width,
          canvas.height
        );
      } catch {
        setErr(true);
      }
    };
    img.onerror = () => setErr(true);
    img.src = imageSrc;
  }, [imageSrc, bbox.x, bbox.y, bbox.w, bbox.h, maxHeight]);

  if (err) {
    return (
      <span className="text-[10px] text-slate-400" title="Náhled nelze vykreslit">
        —
      </span>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className="block max-h-16 rounded border border-slate-200 bg-slate-50"
      aria-hidden
    />
  );
}
