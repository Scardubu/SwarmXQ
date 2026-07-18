"use client";

import { useRouter } from "next/navigation";
import { SeriesWizardForm } from "@/components/series/SeriesWizardForm";

export default function NewSeriesPage() {
  const router = useRouter();

  function handleCreated(seriesId: string) {
    router.push(`/series/${seriesId}`);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <SeriesWizardForm onCreated={handleCreated} />
    </div>
  );
}
