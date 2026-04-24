import { WeekPlannerPage } from "@/components/features/WeekPlannerPage";

/**
 * /planifier — Trello-style weekly meal board.
 *
 * 7 day-columns × 3 meal-slots (midi / soir / snack). Each card is a
 * `PlannedMeal` entry (backed by /api/meal-plans) that can be dragged
 * between cells.
 */
export default function Page() {
  return <WeekPlannerPage />;
}
