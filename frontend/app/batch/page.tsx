import { BatchesListPage } from "@/components/features/BatchesPage";

/**
 * /batch = "Panier" in the new nav — same entry point as the legacy
 * /batches route for Phase 1. Phase 2 will reframe this as a grocery-cart
 * metaphor where adding a recipe populates the current batch-in-progress.
 */
export default function Page() {
  return <BatchesListPage />;
}
