import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { LobbyLayoutResponse } from "@workspace/api-zod/lobby-layout";

export function useLobbyLayout() {
  return useQuery({
    queryKey: ["lobby.layout"],
    queryFn: ({ signal }) =>
      customFetch<LobbyLayoutResponse>("/api/lobby/layout", { signal }),
    staleTime: 0,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}
