import { PersonalStatsPage } from "@/components/features/PersonalStatsPage";

/**
 * /stats — usage statistics from the last 90 days (item #36).
 *
 * Top recipes, weekly batches, average cost per portion. Uses the
 * aggregated endpoint /api/stats/personal so the page is one request.
 */
export default function Page() {
  return <PersonalStatsPage />;
}
