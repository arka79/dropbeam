'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function QRCodeImage({ value, size = 192 }: { value: string; size?: number }) {
  const [data, setData] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: size,
      color: {
        dark: '#06070a',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (!cancelled) setData(url);
      })
      .catch(() => setData(null));
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!data) {
    return (
      <div
        className="animate-pulse-slow rounded-2xl bg-white/5"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div className="rounded-2xl bg-white p-3 shadow-2xl shadow-beam-500/10">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={data} alt="QR code" width={size} height={size} className="block rounded-lg" />
    </div>
  );
}
