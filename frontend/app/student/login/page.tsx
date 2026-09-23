"use client";

import { Suspense } from "react";
import { RoleLogin } from "@/components/auth/role-login";

function StudentLoginContent() {
  return (
    <RoleLogin
      role="STUDENT"
      eyebrow="Student Portal"
      title="Sign in to your learning portal"
      subtitle="Access chapters, quizzes, progress tracking and AI-powered study support."
      defaultNext="/student"
      allowRegistration
    />
  );
}

export default function StudentLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="size-10 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
        </div>
      }
    >
      <StudentLoginContent />
    </Suspense>
  );
}