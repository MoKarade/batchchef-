import { CartPage } from "@/components/features/CartPage";

/**
 * /batch — the new "Panier" view. Users build a draft batch by clicking +
 * on recipe cards, tune portions here, then finalize to generate the real
 * batch via /api/batches/generate. Past batches live at /batches (plural).
 */
export default function Page() {
  return <CartPage />;
}
