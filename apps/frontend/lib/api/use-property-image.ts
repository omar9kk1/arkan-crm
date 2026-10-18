'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getPropertyImage } from './properties-api';

/**
 * Loads a property's single image through the authenticated
 * `GET /properties/:id/image` endpoint.
 *
 * The bytes are fetched with an `Authorization` header, turned into an object
 * URL and released again as soon as the consumer unmounts or the property
 * changes — a private blob is never turned into a permanent URL, and the token
 * is never placed in a URL or in an `src` attribute. A late response can never
 * win over a newer one.
 *
 * `enabled` lets list surfaces defer the request until the row is on screen, so
 * a long list does not fire one private-image request per row on mount.
 */
export interface PropertyImageState {
  /** Object URL to render, or `null` while absent, loading or failed. */
  src: string | null;
  loading: boolean;
  /** Non-null when the image could not be loaded; the surface falls back. */
  error: string | null;
}

const IDLE: PropertyImageState = { src: null, loading: false, error: null };

export function usePropertyImage(
  propertyId: string | null | undefined,
  enabled = true,
): PropertyImageState {
  const [state, setState] = useState<PropertyImageState>(IDLE);

  useEffect(() => {
    if (!propertyId || !enabled) {
      setState(IDLE);
      return;
    }
    let active = true;
    let objectUrl: string | null = null;
    setState({ src: null, loading: true, error: null });

    getPropertyImage(propertyId)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ src: objectUrl, loading: false, error: null });
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setState({
          src: null,
          loading: false,
          error: cause instanceof Error ? cause.message : 'تعذر تحميل الصورة.',
        });
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [propertyId, enabled]);

  return state;
}

export interface ViewportResult<T extends Element> {
  /** Attach to the element whose visibility should gate the request. */
  ref: (node: T | null) => void;
  /** True once the element has come within the pre-fetch margin of the view. */
  inView: boolean;
}

/**
 * Reports `true` the first time an element approaches the viewport (or right
 * away when IntersectionObserver is unavailable). Used to fetch private images
 * only for the rows a user can actually see.
 */
export function useInViewport<T extends Element>(): ViewportResult<T> {
  const [inView, setInView] = useState(false);
  const observer = useRef<IntersectionObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const instance = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          instance.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    instance.observe(node);
    observer.current = instance;
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return { ref, inView };
}
