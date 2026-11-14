"use client";

import { useCallback } from "react";
import { useQuery, type QueryKey } from "@tanstack/react-query";

export interface LoadResult<T> {
  /** Last loaded value; undefined until the first load succeeds. */
  data: T | undefined;
  /** First load for this key is in flight (nothing to show yet). */
  loading: boolean;
  /** A reload is in flight while earlier data is still shown. */
  refreshing: boolean;
  /** Any load is in flight (first or reload). */
  fetching: boolean;
  /** Message of the last failed load, or null. Earlier data is kept. */
  error: string | null;
  /** Reload now. Resolves when the load settles; never rejects. */
  refresh: () => Promise<void>;
}

/**
 * Load remote data for a view: on mount, when `key` changes, on `refresh()`,
 * and every `refreshMs` when given. This is the one place views fetch on mount,
 * so no component calls setState from an effect to do it.
 *
 * Behaves like the hand-written loaders it replaced: one attempt per load, no
 * reload on window focus. Unlike them, results are shared between components
 * using the same key and shown again immediately when a view is reopened, while
 * a fresh load runs.
 */
export function useLoad<T>(options: {
  key: QueryKey;
  load: () => Promise<T>;
  /** Shown as `error` when a failed load did not throw an Error. */
  errorMessage: string;
  /** Turns a failed load into the `error` text, instead of the Error's message. */
  describeError?: (error: unknown) => string;
  /** False: load nothing and report `loading: false` (e.g. no address yet). */
  enabled?: boolean;
  refreshMs?: number;
}): LoadResult<T> {
  const query = useQuery({
    queryKey: options.key,
    queryFn: options.load,
    enabled: options.enabled ?? true,
    refetchInterval: options.refreshMs,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const { refetch } = query;
  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    data: query.data,
    loading: query.isLoading,
    refreshing: query.isRefetching,
    fetching: query.isFetching,
    error: !query.isError
      ? null
      : options.describeError
        ? options.describeError(query.error)
        : query.error instanceof Error
          ? query.error.message
          : options.errorMessage,
    refresh,
  };
}
