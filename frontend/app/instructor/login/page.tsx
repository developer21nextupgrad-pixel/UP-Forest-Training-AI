"use client";

import { Suspense } from "react";
import { RoleLogin } from "@/components/auth/role-login";

function InstructorLoginContent() {
  return (
    <RoleLogin
      role="INSTRUCTOR"
      eyebrow="Instructor Portal"
      title="Sign in to your instructor portal"
      subtitle="Manage learners, learning content, quizzes and performance analytics."
      defaultNext="/instructor"
    />
  );
}

export default function InstructorLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="size-10 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
        </div>
      }
    >
      <InstructorLoginContent />
    </Suspense>
  );
}