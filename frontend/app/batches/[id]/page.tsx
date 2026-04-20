"use client";

import { use } from "react";
import { BatchDetailPage } from "@/components/features/BatchDetailPage";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <BatchDetailPage batchId={parseInt(id, 10)} />;
}
