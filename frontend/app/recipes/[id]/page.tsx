"use client";

import { use } from "react";
import { RecipeDetailPage } from "@/components/features/RecipeDetailPage";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <RecipeDetailPage recipeId={parseInt(id, 10)} />;
}
