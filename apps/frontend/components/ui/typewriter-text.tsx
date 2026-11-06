'use client';
import { useEffect, useState } from 'react';

export function TypewriterText({
  text,
  speed = 75,
}: {
  text: string;
  speed?: number;
}) {
  const [displayed, setDisplayed] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      if (mq.matches) {
        setDisplayed(text);
        return;
      }
    }
    // grapheme-aware segmentation
    let segments: string[] = [];
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Seg = (Intl as any).Segmenter;
      if (Seg) {
        const seg = new Seg('ar', { granularity: 'grapheme' });
        segments = [...seg.segment(text)].map((s: { segment: string }) => s.segment);
      } else {
        segments = Array.from(text);
      }
    } catch {
      segments = Array.from(text);
    }
    let i = 0;
    setDisplayed('');
    const id = window.setInterval(() => {
      i += 1;
      setDisplayed(segments.slice(0, i).join(''));
      if (i >= segments.length) window.clearInterval(id);
    }, speed);
    return () => window.clearInterval(id);
  }, [text, speed]);

  return (
    <span
      style={{ display: 'inline-block', minWidth: `${text.length}ch`, whiteSpace: 'nowrap' }}
      aria-label={text}
    >
      {displayed}
    </span>
  );
}
