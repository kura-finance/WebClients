"use client";

import {
  listBorrowMorphoMarkets,
  pickMarketsByCollateral,
  type MorphoMarket,
} from "@/lib/morphoApi";
import { useLoad } from "@/hooks/useLoad";

const NO_MARKETS: MorphoMarket[] = [];

export function useMorphoBorrowMarkets() {
  const { data, loading, refreshing, error, refresh } = useLoad({
    key: ["morpho", "borrow-markets"],
    load: async () => pickMarketsByCollateral(await listBorrowMorphoMarkets()),
    errorMessage: "Failed to load Morpho borrow markets",
  });

  return { markets: data ?? NO_MARKETS, loading, refreshing, error, refresh };
}
