/** Short markdown fixtures for authoritative-doc selection tests (no secrets). */
export const FAKE_CONSTITUTION = "# Constitution\n\nRonda is comment-only.\n";
export const FAKE_REVIEW_CONTRACT = "# Review contract\n\nFind blocking defects.\n";
export const FAKE_ARCHITECTURE = "# Architecture\n\nCore lives under src/core.\n";
export const FAKE_ADOPTION = "# Adoption\n\nConfigure the model API key locally.\n";

export const FAKE_AUTHORITATIVE_DOC_CONTENT_BY_PATH: Record<string, string> = {
  "docs/constitution.md": FAKE_CONSTITUTION,
  "REVIEW.md": FAKE_REVIEW_CONTRACT,
  "docs/project/3-software-architecture.md": FAKE_ARCHITECTURE,
  "docs/adoption/ronda-review-adoption.md": FAKE_ADOPTION,
};
