import type { DisplayInfo, NodeStatus, OutputStatus } from "../shared/types";

export interface UiStatus {
  local: { displays: DisplayInfo[]; outputs: OutputStatus[]; missingMedia: string[]; addresses: string[] };
  nodes: (NodeStatus & { outputs: OutputStatus[]; missingMedia: string[] })[];
  osc: { listening: boolean; error: string; last: string };
  showMode: boolean;
}

export const EMPTY_STATUS: UiStatus = {
  local: { displays: [], outputs: [], missingMedia: [], addresses: [] },
  nodes: [],
  osc: { listening: false, error: "", last: "" },
  showMode: false,
};

export function outputStatus(status: UiStatus, outputId: string, node: string): OutputStatus | undefined {
  if (node === "local") return status.local.outputs.find((o) => o.outputId === outputId);
  return status.nodes.find((n) => n.id === node)?.outputs.find((o) => o.outputId === outputId);
}
