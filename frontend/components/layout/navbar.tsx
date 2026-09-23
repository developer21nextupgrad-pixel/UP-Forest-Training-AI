"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Settings as SettingsIcon, UserCircle2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { APP_NAME, NAV_LINKS } from "@/lib/constants";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-provider";

export function Navbar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/20 bg-black/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 text-base font-semibold tracking-tight">
          <span className="flex size-9 items-center justify-center rounded-xl bg-[#063c2b] text-white shadow-sm">
            <span className="text-sm font-bold">F</span>
          </span>
          <span className="hidden sm:inline">{APP_NAME}</span>
        </Link>

        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-emerald-50 text-[#08744f] dark:bg-emerald-950/40 dark:text-emerald-300" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-1.5">
          <Link href="/settings" aria-label="Settings" className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "hidden md:inline-flex")}>
            <SettingsIcon className="size-4" />
          </Link>
          {user ? (
            <div className="ml-1 flex items-center gap-2 rounded-full border border-border bg-card px-2 py-1">
              <div className="flex size-8 items-center justify-center rounded-full bg-emerald-50 text-[#08744f] dark:bg-emerald-950/50 dark:text-emerald-300">
                <UserCircle2 className="size-5" />
              </div>
              <div className="hidden max-w-32 md:block">
                <p className="truncate text-xs font-semibold">{user.full_name}</p>
                <p className="text-[10px] text-muted-foreground">{user.role}</p>
              </div>
              <button onClick={() => void logout()} aria-label="Log out" title="Log out" className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
                <LogOut className="size-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2"><Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>Sign in</Link><Link href="/register" className={buttonVariants({ variant: "default", size: "sm" })}>Sign up</Link></div>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
