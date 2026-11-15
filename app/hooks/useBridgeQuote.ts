"use client";

import { fetchBridgeQuote, type LiFiBridgeQuote } from "@/lib/lifiBridge";
import { errMessage } from "@/lib/formatDisplay";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useLoad } from "@/hooks/useLoad";

export interface BridgeQuoteRequest {
  fromChainId: number;
  toChainId: number;
  fromAmountWei: string;
  fromAddress: string;
  toAddress: string;
}

const QUOTE_DEBOUNCE_MS = 400;

/**
 * Li.Fi bridge quote for the send the user is entering; pass null while the
 * inputs do not describe a valid bridge.
 *
 * `quote` is only ever a quote for exactly the current request: it is null
 * while the user is still typing and after a failed load. During `refresh()`
 * the previous quote for the same request stays visible, with `isQuoting` true.
 */
export function useBridgeQuote(request: BridgeQuoteRequest | null): {
  quote: LiFiBridgeQuote | null;
  quoteError: string | null;
  isQuoting: boolean;
  refresh: () => Promise<void>;
} {
  const requestKey = request
    ? [
        request.fromChainId,
        request.toChainId,
        request.fromAddress,
        request.toAddress,
        request.fromAmountWei,
      ]
        .join(":")
        .toLowerCase()
    : null;
  const settledKey = useDebouncedValue(requestKey, QUOTE_DEBOUNCE_MS);
  const settled = request !== null && requestKey === settledKey;

  const { data, fetching, error, refresh } = useLoad({
    key: ["lifi", "bridge-quote", settledKey],
    load: () => fetchBridgeQuote(request as BridgeQuoteRequest),
    errorMessage: "Failed to get a bridge quote",
    describeError: errMessage,
    enabled: settled,
  });

  return {
    quote: settled && !error ? (data ?? null) : null,
    quoteError: settled && !fetching ? error : null,
    // Still typing counts as quoting: a quote for these inputs is on its way.
    isQuoting: request !== null && (!settled || fetching),
    refresh,
  };
}
