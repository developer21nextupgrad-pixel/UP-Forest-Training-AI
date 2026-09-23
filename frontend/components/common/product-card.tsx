"use client";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ArrowRight } from "lucide-react";
import Image from "next/image";

interface ProductCardProps {
  href: string;
  image: string;
  category: string;
  title: string;
  tags: string[];
  description: string;
  benefits: string[];
  cta: string;
  icon: React.ComponentType<{ className?: string }>;
  comingSoon?: boolean;
}

export function ProductCard({
  href,
  image,
  category,
  title,
  tags,
  description,
  benefits,
  cta,
  icon: Icon,
  comingSoon = false,
}: ProductCardProps) {
  return (
    <Card
      className={cn(
        "group relative flex h-[350px] flex-col overflow-hidden rounded-2xl",
        "border border-white/15 bg-black/75",
        "shadow-[0_12px_35px_rgba(0,0,0,0.35)]",
        "transition-all duration-300",
        "hover:-translate-y-1 hover:border-emerald-400/35",
        "hover:shadow-[0_18px_45px_rgba(0,0,0,0.5)]"
      )}
    >
      {/* Card Image */}
      <div className="relative h-[92px] w-full shrink-0 overflow-hidden">
        <Image
          src={image}
          alt={title}
          fill
          sizes="(max-width: 768px) 100vw, 33vw"
          className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />

        {/* Image overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/25 to-black/95" />
      </div>

      {/* Content */}
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-3 pt-3">
        {/* Category */}
        <div className="mb-1 flex items-center gap-2">
          <Icon className="h-5 w-5 shrink-0 text-emerald-400" />

          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-300">
            {category}
          </span>
        </div>

        {/* Title */}
        <h3 className="mb-1.5 text-[19px] font-semibold leading-tight text-white">
          {title}
        </h3>

        {/* Tags */}
        <div className="mb-1.5 flex flex-wrap gap-1">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-emerald-400/10 bg-emerald-500/15 px-2 py-[2px] text-[10px] font-medium leading-4 text-emerald-300"
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Description */}
        <p className="mb-1.5 line-clamp-2 text-[12px] leading-[1.35] text-emerald-100/85">
          {description}
        </p>

        {/* Benefits */}
        <ul className="space-y-[2px] text-[12px] leading-[1.4] text-emerald-100/85">
          {benefits.map((benefit) => (
            <li key={benefit} className="flex items-start gap-1.5">
              <span className="shrink-0 text-emerald-400">✓</span>
              <span>{benefit}</span>
            </li>
          ))}
        </ul>

        {/* CTA */}
        <div className="mt-auto pt-2">
          {comingSoon ? (
            <span className="inline-flex h-8 items-center rounded-full border border-emerald-400/10 bg-emerald-500/15 px-3 text-[11px] font-medium text-emerald-300">
              Coming Soon
            </span>
          ) : (
            <a
              href={href}
              className={cn(
                "flex h-10 w-full items-center justify-center gap-2",
                "rounded-xl border border-emerald-300/10",
                "bg-emerald-500",
                "px-4 text-sm font-semibold text-white",
                "transition-all duration-200",
                "hover:bg-emerald-400",
                "hover:shadow-lg hover:shadow-emerald-500/20"
              )}
            >
              {cta}

              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
            </a>
          )}
        </div>
      </div>
    </Card>
  );
}