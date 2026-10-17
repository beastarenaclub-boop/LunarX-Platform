export function entryDestination(value: string | null) {
  if (
    !value ||
    value.length > 4096 ||
    !/^\/(?:login|signup|member\/(?:login|signup|dashboard)|(?:admin|agent)\/(?:login|dashboard))(?:\?|$)/.test(
      value,
    )
  )
    return "/login";
  const url = new URL(value, "https://entry.invalid");
  return url.origin === "https://entry.invalid"
    ? url.pathname + url.search
    : "/login";
}
