export type AuthoritativeDocSurface =
  | "webhook_ingress"
  | "review_publication"
  | "review_inference"
  | "operator_config"
  | "workflow_review_contract";

export type AuthoritativeDocRole = "binding" | "advisory";

export interface AuthoritativeDocCatalogEntry {
  id: string;
  path: string;
  role: AuthoritativeDocRole;
  /** Lower values outrank higher values when budgets trim the candidate set. */
  priority: number;
  surfaces: AuthoritativeDocSurface[];
}

const ALL_SURFACES: AuthoritativeDocSurface[] = [
  "webhook_ingress",
  "review_publication",
  "review_inference",
  "operator_config",
  "workflow_review_contract",
];

/** Default authoritative catalog for review passes (MVP — fixed paths at head SHA). */
export const DEFAULT_AUTHORITATIVE_DOC_CATALOG: AuthoritativeDocCatalogEntry[] = [
  {
    id: "constitution",
    path: "docs/constitution.md",
    role: "binding",
    priority: 10,
    surfaces: ALL_SURFACES,
  },
  {
    id: "review-contract",
    path: "REVIEW.md",
    role: "binding",
    priority: 20,
    surfaces: ALL_SURFACES,
  },
  {
    id: "software-architecture",
    path: "docs/project/3-software-architecture.md",
    role: "advisory",
    priority: 30,
    surfaces: ALL_SURFACES,
  },
  {
    id: "review-adoption",
    path: "docs/adoption/ronda-review-adoption.md",
    role: "advisory",
    priority: 40,
    surfaces: ALL_SURFACES,
  },
];
