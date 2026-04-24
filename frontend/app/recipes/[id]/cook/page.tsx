import { CookingModePage } from "@/components/features/CookingModePage";

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * /recipes/[id]/cook — fullscreen cooking mode (item #32).
 *
 * Large instruction text, step-by-step navigation, per-step timers.
 * Designed for a tablet on the counter while you cook.
 */
export default async function Page({ params }: Props) {
  const { id } = await params;
  return <CookingModePage recipeId={parseInt(id)} />;
}
