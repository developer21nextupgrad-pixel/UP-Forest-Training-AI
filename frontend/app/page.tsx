"use client";

import { ProductCard } from "@/components/common/product-card";
import {
  BookOpen,
  ClipboardCheck,
  Bot,
  ArrowRight,
} from "lucide-react";

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground transition-colors duration-300">
      {/* Background */}
      <div className="absolute inset-0 -z-20 bg-[url('/forest.jpg')] bg-cover bg-center bg-no-repeat" />

      {/* Theme-aware background overlay */}
      <div className="absolute inset-0 -z-10 bg-white/85 dark:bg-black/60" />

      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-white/65 via-white/80 to-background dark:from-black/35 dark:via-black/65 dark:to-background" />

      <main className="relative z-10 mx-auto min-h-screen max-w-[1500px] px-5 py-4 lg:px-7">
        {/* HERO */}
        <section className="mb-4 text-center">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
            Uttar Pradesh Forest Department
          </p>

          <h1 className="text-3xl font-bold leading-tight tracking-tight text-foreground lg:text-[38px]">
            Knowledge for{" "}
            <span className="text-primary">conservation.</span>
          </h1>

          <p className="mx-auto mt-1.5 max-w-4xl text-[13px] leading-5 text-muted-foreground lg:text-[14px]">
            Explore laws, get field guidance, and advance your learning —
            for greener forests and a sustainable tomorrow.
          </p>
        </section>

        {/* FEATURE ROW */}
        <section className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            "Protect Biodiversity",
            "Empower Field Officers",
            "Build Knowledge",
            "For a Sustainable Tomorrow",
          ].map((text) => (
            <div
              key={text}
              className="flex h-10 items-center gap-2 rounded-xl border border-primary/15 bg-card/80 px-3 shadow-sm backdrop-blur-md transition-colors duration-300 dark:bg-card/75"
            >
              <ArrowRight className="h-4 w-4 shrink-0 text-primary" />

              <span className="text-xs font-medium text-foreground/80">
                {text}
              </span>
            </div>
          ))}
        </section>

        {/* PRODUCT CARDS */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <ProductCard
            href="/legal/login"
            image="/legal.jpg"
            icon={BookOpen}
            category="LEGAL KNOWLEDGE"
            title="Forest Laws & Compliance"
            tags={["Acts", "Rules", "Orders", "Judgments"]}
            description="Ask questions with cited source pages and verified legal documents."
            benefits={[
              "Document-based answers",
              "Source page citations",
              "Forest-law knowledge",
            ]}
            cta="Enter Legal Portal"
          />

          <ProductCard
            href="/field"
            image="/field.jpg"
            icon={ClipboardCheck}
            category="FIELD OPERATIONS"
            title="Field Officer Assistant"
            tags={["Hindi", "Voice", "SOPs", "Field Guides"]}
            description="Operational guidance for patrolling, plantation, fire watch and field procedures."
            benefits={[
              "Practical field guidance",
              "SOP-based assistance",
              "Mobile-friendly experience",
            ]}
            cta="Open Field Assistant"
          />

          <ProductCard
            href="/training"
            image="/training.jpg"
            icon={Bot}
            category="LEARNING PLATFORM"
            title="Training & Learning"
            tags={["AI Tutor", "Quizzes", "Progress", "Chapters"]}
            description="Learn chapters, practice MCQs and track your progress."
            benefits={[
              "Structured learning",
              "AI-powered study support",
              "Progress tracking",
            ]}
            cta="Enter Training Portal"
          />
        </section>

        {/* STATS */}
        <section className="mt-4 rounded-2xl border border-primary/15 bg-card/80 px-4 py-3 shadow-sm backdrop-blur-md transition-colors duration-300 dark:bg-card/75">
          <div className="grid grid-cols-2 gap-3 text-center md:grid-cols-4">
            <div>
              <p className="text-xl font-bold text-primary">
                4,000+
              </p>
              <p className="text-[11px] text-muted-foreground">
                Documents & Resources
              </p>
            </div>

            <div>
              <p className="text-xl font-bold text-primary">
                320
              </p>
              <p className="text-[11px] text-muted-foreground">
                Acts & Laws
              </p>
            </div>

            <div>
              <p className="text-xl font-bold text-primary">
                580
              </p>
              <p className="text-[11px] text-muted-foreground">
                SOPs & Manuals
              </p>
            </div>

            <div>
              <p className="text-xl font-bold text-primary">
                1,250
              </p>
              <p className="text-[11px] text-muted-foreground">
                Training Materials
              </p>
            </div>
          </div>
        </section>

        {/* FOOTER */}
        <footer className="pt-3 text-center text-[11px] text-muted-foreground">
          <p>
            Conserving Forests | Empowering People | Building a Greener Tomorrow
          </p>

          <p className="mt-0.5">
            Uttar Pradesh Forest Department | Van Hain To Kal Hai
          </p>
        </footer>
      </main>
    </div>
  );
}