"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Auth disabled — redirect to home.
export default function RegisterPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/");
  }, [router]);
  return null;
}
