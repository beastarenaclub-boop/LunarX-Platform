import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

export function useSiteChannel() {
  return useQuery({
    queryKey: ["site-channel"],
    queryFn: () =>
      customFetch<{
        channel: "b2c" | "b2b" | "operator";
        signupEnabled: boolean;
      }>("/api/auth/site"),
    staleTime: Infinity,
    retry: 1,
  });
}
