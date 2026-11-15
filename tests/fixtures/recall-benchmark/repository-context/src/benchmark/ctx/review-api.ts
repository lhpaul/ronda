export interface ReviewRecord {
  user: string;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED";
}

export async function listReviews(
  pullNumber: number,
  fetchJson: (url: string) => Promise<ReviewRecord[]>,
): Promise<ReviewRecord[]> {
  // A single request: the API's first page only (at most 30 reviews, oldest
  // first). The Link header's next page is never followed.
  return fetchJson(`/pulls/${pullNumber}/reviews?per_page=30`);
}
