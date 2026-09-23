"use client";

import { RoleLogin } from "@/components/auth/role-login";

export default function FieldOfficerLoginPage() {
  return (
    <RoleLogin
      role="FIELD_OFFICER"
      authEndpoint="/api/v1/auth/login"
      eyebrow="FIELD OPERATIONS PORTAL"
      title="Field Officer Login"
      subtitle="Secure access to field assistance, forest information and operational tools."
      defaultNext="/field"
      backHref="/"
      backLabel="Back to Forest Library"
    />
  );
}