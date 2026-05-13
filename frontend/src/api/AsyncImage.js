import React, { useEffect, useState } from 'react';

/**
 * Renders an <img> sourced from a loader function that returns either
 * `{src, revoke?}` or a Promise of the same shape.
 *
 * Web mode loaders return a static URL synchronously (no revoke).
 * Local mode loaders return a blob URL asynchronously (with a revoke fn).
 *
 * Re-runs the loader whenever any value in `deps` changes; revokes the
 * previous URL on change/unmount so blob URLs do not leak.
 */
function AsyncImage({ loader, deps = [], alt = '', ...imgProps }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let revoke = null;

    Promise.resolve(loader()).then((result) => {
      if (cancelled) {
        result?.revoke?.();
        return;
      }
      setSrc(result.src);
      revoke = result.revoke;
    });

    return () => {
      cancelled = true;
      revoke?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  if (!src) return null;
  return <img src={src} alt={alt} {...imgProps} />;
}

export default AsyncImage;
