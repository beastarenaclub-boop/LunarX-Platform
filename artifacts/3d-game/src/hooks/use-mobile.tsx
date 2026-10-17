import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}

// Matches Tailwind's `lg` breakpoint (1024px). Used to mount breakpoint-
// specific layout sections exactly once — CSS `hidden lg:flex` duplicates
// would leave two copies of the same data-testids in the DOM.
const LG_BREAKPOINT = 1024

export function useIsLgUp() {
  const [isLgUp, setIsLgUp] = React.useState<boolean>(
    () => typeof window !== "undefined" && window.innerWidth >= LG_BREAKPOINT,
  )

  React.useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${LG_BREAKPOINT}px)`)
    const onChange = () => setIsLgUp(mql.matches)
    mql.addEventListener("change", onChange)
    setIsLgUp(mql.matches)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isLgUp
}
