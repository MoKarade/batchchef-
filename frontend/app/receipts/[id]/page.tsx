"use client";

import { use } from "react";
import { ReceiptDetailPage } from "@/components/features/ReceiptDetailPage";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ReceiptDetailPage scanId={parseInt(id, 10)} />;
}
