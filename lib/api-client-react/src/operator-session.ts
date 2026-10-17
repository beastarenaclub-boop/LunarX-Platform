export type OperatorPanel = "master" | "agent";

// Kept in this tab's module state, never shared through localStorage.
let operatorPanel: OperatorPanel | null = null;

export function setOperatorPanel(panel: OperatorPanel) {
  operatorPanel = panel;
}

export function getOperatorPanel() {
  return operatorPanel;
}
