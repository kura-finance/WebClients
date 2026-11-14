"use client";

import { listEarnMorphoVaults, type MorphoVault } from "@/lib/morphoApi";
import { useLoad } from "@/hooks/useLoad";

const NO_VAULTS: MorphoVault[] = [];

export function useMorphoVaults() {
  const { data, loading, refreshing, error, refresh } = useLoad({
    key: ["morpho", "earn-vaults"],
    load: listEarnMorphoVaults,
    errorMessage: "Failed to load Morpho vaults",
  });

  return { vaults: data ?? NO_VAULTS, loading, refreshing, error, refresh };
}
