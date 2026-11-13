export interface DeployEvent {
  environment: string;
  state: "queued" | "success" | "failure";
  createdAt: string;
}

export async function listDeployEvents(
  environment: string,
  fetchJson: (url: string) => Promise<DeployEvent[]>,
): Promise<DeployEvent[]> {
  // The deployments API returns events newest first (direction=desc), so
  // events[0] is the most recent event and the last element is the oldest.
  return fetchJson(`/deployments/${encodeURIComponent(environment)}/events?direction=desc`);
}
