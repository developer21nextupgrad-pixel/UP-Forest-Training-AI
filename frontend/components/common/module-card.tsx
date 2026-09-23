"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";

interface ModuleCardProps {
  href: string;
  icon: LucideIcon;
  title: string;
  tags: string[];
  description: string;
  buttonText: string;
  comingSoon?: boolean;
}

export function ModuleCard({
  href,
  icon: Icon,
  title,
  tags,
  description,
  buttonText,
  comingSoon = false,
}: ModuleCardProps) {
  return (
    <Card className="flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-6 shadow-sm">
      <div>
        <div className="flex items-center gap-3 mb-4">
          <Icon className="size-6 text-emerald-500" />
          <h3 className="text-xl font-semibold">{title}</h3>
        </div>
        <div className="flex flex-wrap gap-2 mb-4">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-emerald-100/20 px-2 py-0.5 text-xs font-medium text-emerald-500"
            >
              {tag}
            </span>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="mt-6">
        {comingSoon ? (
          <span className="inline-block rounded-full bg-emerald-100/20 px-3 py-1 text-xs font-medium text-emerald-500">
            Coming Soon
          </span>
        ) : (
          <Link href={href} passHref>
            <Button variant="outline" className="w-full">
              {buttonText}
            </Button>
          </Link>
        )}
      </div>
    </Card>
  );
}
