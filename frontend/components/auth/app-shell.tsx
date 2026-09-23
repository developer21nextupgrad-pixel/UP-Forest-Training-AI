"use client";

import { usePathname } from "next/navigation";
import { AuthProvider } from "@/components/auth/auth-provider";
import { Navbar } from "@/components/layout/navbar";
import { PortalShell } from "@/components/layout/portal-shell";
import { Footer } from "@/components/layout/footer";
import { Toaster } from "@/components/ui/sonner";
import { RagChatWidget } from "@/components/rag/rag-chat-widget";

const AUTH_PATHS = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/student/login",
  "/instructor/login",
  "/admin/login",
  "/legal/login",
  "/field/login",
];

const PORTAL_PREFIXES = [
  "/student",
  "/admin",
  "/instructor",
  "/field",
];

function isPortalPath(pathname: string) {
  return PORTAL_PREFIXES.some(
    (prefix) =>
      pathname === prefix ||
      pathname.startsWith(`${prefix}/`),
  );
}

export function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const isAuthPage = AUTH_PATHS.includes(pathname);
  const isPortal = isPortalPath(pathname);

  return (
    <AuthProvider>
      {isAuthPage ? (
        children
      ) : isPortal ? (
        <PortalShell>{children}</PortalShell>
      ) : (
        <>
          <Navbar />
          <main className="flex-1">{children}</main>
          <Footer />
        </>
      )}

      <Toaster />

      {!isAuthPage && !isPortal && <RagChatWidget />}
    </AuthProvider>
  );
}