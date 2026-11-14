"use client";

import { useEffect, useState } from "react";

/**
 * `value`, but only after it has stopped changing for `delayMs`. Pass a
 * primitive (or a stable reference): a new object every render never settles.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
