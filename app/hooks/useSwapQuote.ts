"use client";

import { fetchSwapQuote, type SwapQuote } from "@/lib/lifiSwap";
import { errMessage } from "@/lib/formatDisplay";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useLoad } from "@/hooks/useLoad";

export interface SwapQuoteRequest {
  fromAmountWei: string;
  fromAddress: string;
  fromTokenAddress: string;
  toTokenAddress: string;
}

const QUOTE_DEBOUNCE_MS = 400;

/**
 * Li.Fi quote for the swap the user is entering; pass null while the inputs do
 * not describe a valid swap.
 *
 * `quote` is only ever the quote for exactly the current request: it is null
 * while the user is still typing, while a quote is loading, and after a failed
 * load — so a quote for an earlier amount can never be executed.
 */
export function useSwapQuote(request: SwapQuoteRequest | null): {
  quote: SwapQuote | null;
  quoteError: string | null;
  isQuoting: boolean;
} {
  const requestKey = request
    ? [
        request.fromAddress,
        request.fromTokenAddress,
        request.toTokenAddress,
        request.fromAmountWei,
      ]
        .join(":")
        .toLowerCase()
    : null;
  const settledKey = useDebouncedValue(requestKey, QUOTE_DEBOUNCE_MS);
  const settled = request !== null && requestKey === settledKey;

  const { data, fetching, error } = useLoad({
    key: ["lifi", "swap-quote", settledKey],
    load: () => fetchSwapQuote(request as SwapQuoteRequest),
    errorMessage: "Failed to get a quote",
    describeError: errMessage,
    enabled: settled,
  });

  return {
    quote: settled && !fetching && !error ? (data ?? null) : null,
    quoteError: settled && !fetching ? error : null,
    isQuoting: settled && fetching,
  };
}
