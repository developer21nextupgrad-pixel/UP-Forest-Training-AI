"use client";

import { RoleLogin } from "@/components/auth/role-login";

export default function LegalLoginPage() {
    return (
        <RoleLogin
            role="LEGAL_USER"
            authEndpoint="/api/v1/legal/auth/login"
            eyebrow="FOREST LAWS & COMPLIANCE"
            title="Legal Knowledge Portal"
            subtitle="Secure access to verified forest laws, rules, orders, judgments and document-grounded answers."
            defaultNext="/legal"
            backHref="/"
            backLabel="Back to Forest Library"
        />
    );
}