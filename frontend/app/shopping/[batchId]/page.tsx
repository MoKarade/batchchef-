"use client";

import { use } from "react";
import { ShoppingListPage } from "@/components/features/ShoppingListPage";

export default function Page({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = use(params);
  return <ShoppingListPage batchId={parseInt(batchId, 10)} />;
}
