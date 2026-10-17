import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { DialogContent } from "@/components/ui/dialog";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Secondary game controls slide in without changing the playable layout. */
export function GameInformationDrawer({ className, ...props }: ComponentProps<typeof DialogContent>) {
  return <DialogContent {...props} data-game-information-drawer
    className={cn(className, "game-information-drawer")} />;
}

const InformationContext = createContext<{
  target: HTMLDivElement | null;
  setTarget: (target: HTMLDivElement | null) => void;
} | null>(null);

export function restoreGameInformationFocus(event: Event) {
  event.preventDefault();
  document
    .querySelector<HTMLButtonElement>('[data-testid="btn-game-rules"]')
    ?.focus({ preventScroll: true });
}

/** Secondary panels keep their live page data, but only render in the info dialog. */
export function GameInformationProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const value = useMemo(() => ({ target, setTarget }), [target]);
  return (
    <InformationContext.Provider value={value}>
      {children}
    </InformationContext.Provider>
  );
}

export function GameInformationTarget() {
  const context = useContext(InformationContext);
  return (
    <div
      ref={context?.setTarget}
      className="game-information-panels"
      data-testid="game-information-panels"
    />
  );
}

export function GameInformationSection({ children }: { children: ReactNode }) {
  const context = useContext(InformationContext);
  // Embedded/standalone pages without a viewport retain their information.
  if (!context) return <>{children}</>;
  return context.target ? createPortal(children, context.target) : null;
}
