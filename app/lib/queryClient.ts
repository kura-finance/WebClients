import { QueryClient } from "@tanstack/react-query";

/**
 * The app's one query cache (wagmi and the `useLoad` data hooks share it).
 * Kept in a module so non-React code can drop cached wallet data on sign-out.
 */
export const queryClient = new QueryClient();
