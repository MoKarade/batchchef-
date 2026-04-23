"use client";

import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Receipt, Upload, Loader2, CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

interface ReceiptScan {
  id: number; image_path: string; store_id?: number; status: string;
  total_amount?: number; error_message?: string; created_at: string;
  items?: Array<{ id: number; raw_name?: string; total_price?: number; is_confirmed: boolean }>;
}

export function ReceiptsListPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data: scans = [], isLoading } = useQuery({
    queryKey: ["receipts"],
    queryFn: () => api.get<ReceiptScan[]>("/api/receipts").then((r) => r.data),
    refetchInterval: 5_000,
  });

  const handleFile = async (file: File) => {
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    await api.post("/api/receipts", form, { headers: { "Content-Type": "multipart/form-data" } });
    await qc.invalidateQueries({ queryKey: ["receipts"] });
    setUploading(false);
  };

  const statusIcon = (status: string) => {
    if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    if (status === "error") return <XCircle className="h-4 w-4 text-destructive" />;
    return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tickets de caisse</h1>
          <p className="text-muted-foreground text-sm mt-0.5">OCR via Gemini Vision</p>
        </div>
      </div>

      {/* Upload zone */}
      <div
        className="rounded-xl border-2 border-dashed bg-card p-8 text-center cursor-pointer hover:border-primary transition-colors"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) handleFile(f);
        }}
      >
        <input
          ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Upload en cours...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium text-sm">Glisser-déposer ou cliquer pour uploader</p>
            <p className="text-xs text-muted-foreground">JPG, PNG — photo d&apos;un ticket Maxi</p>
          </div>
        )}
      </div>

      {/* List */}
      <div className="space-y-3">
        {isLoading && <div className="h-20 rounded-xl border animate-pulse" />}
        {!isLoading && scans.length === 0 && (
          <p className="text-sm text-muted-foreground">Aucun ticket scanné.</p>
        )}
        {scans.map((scan) => (
          <div key={scan.id} className="rounded-xl border bg-card p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Receipt className="h-5 w-5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium">Ticket #{scan.id}</p>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(scan.created_at), "d MMM yyyy HH:mm", { locale: fr })}
                  {scan.total_amount != null && ` — ${scan.total_amount.toFixed(2)} $`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {statusIcon(scan.status)}
              <Link href={`/receipts/${scan.id}`}>
                <button className="text-xs px-3 h-7 rounded-md border hover:bg-accent">
                  Voir détails
                </button>
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
