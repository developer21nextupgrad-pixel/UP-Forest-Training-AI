"use client";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";

export default function FieldAssistant() {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Card className="p-6">
        <h2 className="text-2xl font-semibold mb-4">Field Officer Assistant</h2>
        <p className="text-muted-foreground mb-6">
          This feature is coming soon. Stay tuned for the field assistant that will provide operational guidance.
        </p>
        <Button variant="outline" onClick={() => router.back()}>
          <ArrowRight className="size-4 mr-2" /> Back
        </Button>
      </Card>
    </div>
  );
}
