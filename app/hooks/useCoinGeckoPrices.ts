"use client";

import { useRef } from "react";
import { fetchCoinGeckoPrices, type PriceMap } from "@/lib/coingeckoPrices";
import { useLoad } from "@/hooks/useLoad";

const NO_PRICES: PriceMap = {};

/** CoinGecko spot prices. `refresh()` bypasses the short-lived price cache. */
export function useCoinGeckoPrices() {
  // The first load may be served from the price cache; reloads ask for fresh prices.
  const loadedOnce = useRef(false);

  const { data, loading, refreshing, error, refresh } = useLoad({
    key: ["coingecko", "prices"],
    load: async () => {
      const prices = await fetchCoinGeckoPrices(loadedOnce.current);
      loadedOnce.current = true;
      return prices;
    },
    errorMessage: "Failed to load prices",
  });

  return { prices: data ?? NO_PRICES, loading, refreshing, error, refresh };
}
