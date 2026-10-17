"use client";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

// Keep the entry soundscape mounted while navigating between access screens.
// Using the router directly avoids the bundled Link dynamic-import failure.
export default function EntryLink({
  href,
  onClick,
  ...props
}: ComponentProps<"a"> & { href: string }) {
  const router = useRouter();
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          props.download ||
          (props.target && props.target !== "_self") ||
          !href.startsWith("/") ||
          href.startsWith("//")
        )
          return;
        event.preventDefault();
        router.push(href);
      }}
    />
  );
}
