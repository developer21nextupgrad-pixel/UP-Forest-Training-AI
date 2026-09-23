"use client";

import { Suspense } from "react";
import { RoleLogin } from "@/components/auth/role-login";

function AdminLoginContent() {
  return (
    <RoleLogin
      role="ADMIN"
      eyebrow="Administrator Portal"
      title="Sign in to your admin portal"
      subtitle="Manage users, content, assessments and platform operations."
      defaultNext="/admin"
    />
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="size-10 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
        </div>
      }
    >
      <AdminLoginContent />
    </Suspense>
  );
}