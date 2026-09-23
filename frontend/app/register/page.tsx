"use client";
import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Eye, EyeOff, LockKeyhole, Mail, UserRound } from "lucide-react";
import { toast } from "sonner";
import { AuthShell } from "@/components/auth/auth-shell";
import { apiRequest } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const checks = useMemo(
    () => [
      [password.length >= 8, "At least 8 characters"],
      [/[A-Z]/.test(password), "One uppercase letter"],
      [/[a-z]/.test(password), "One lowercase letter"],
      [/\d/.test(password), "One number"],
    ] as const,
    [password],
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("Passwords do not match."); return; }
    if (!checks.every(([ok]) => ok)) { setError("Please choose a stronger password."); return; }
    setLoading(true);
    const r = await apiRequest("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full_name: fullName.trim(), email: email.trim(), password }),
    });
    setLoading(false);
    if (!r.success) { setError(r.message); return; }
    toast.success("Account created", { description: "Your student account is ready. Please sign in." });
    router.replace("/student/login?registered=1");
  }

  return (
    <AuthShell eyebrow="New account" title="Create your Forest Library account" subtitle="Create a student account to access the Forest Department learning portal.">
      <form onSubmit={submit} className="space-y-4">
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">{error}</div>}
        <label className="block text-sm font-medium">Full name<span className="relative mt-2 block"><UserRound className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><input required value={fullName} onChange={e=>setFullName(e.target.value)} autoComplete="name" placeholder="Your full name" className="h-12 w-full rounded-xl border border-input bg-background pl-10 pr-4 outline-none focus:border-[#0b6b4f] focus:ring-4 focus:ring-[#0b6b4f]/10"/></span></label>
        <label className="block text-sm font-medium">Email address<span className="relative mt-2 block"><Mail className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><input required type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" className="h-12 w-full rounded-xl border border-input bg-background pl-10 pr-4 outline-none focus:border-[#0b6b4f] focus:ring-4 focus:ring-[#0b6b4f]/10"/></span></label>
        <label className="block text-sm font-medium">Password<span className="relative mt-2 block"><LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><input required type={show?"text":"password"} value={password} onChange={e=>setPassword(e.target.value)} autoComplete="new-password" placeholder="Create a secure password" className="h-12 w-full rounded-xl border border-input bg-background pl-10 pr-12 outline-none focus:border-[#0b6b4f] focus:ring-4 focus:ring-[#0b6b4f]/10"/><button type="button" onClick={()=>setShow(v=>!v)} className="absolute right-2 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">{show?<EyeOff className="size-4"/>:<Eye className="size-4"/>}</button></span></label>
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">{checks.map(([ok,label])=><div key={label} className="flex items-center gap-2"><Check className={`size-3.5 ${ok?"text-[#08744f]":"text-muted-foreground/30"}`}/>{label}</div>)}</div>
        <label className="block text-sm font-medium">Confirm password<span className="relative mt-2 block"><LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><input required type={show?"text":"password"} value={confirm} onChange={e=>setConfirm(e.target.value)} autoComplete="new-password" placeholder="Re-enter your password" className="h-12 w-full rounded-xl border border-input bg-background pl-10 pr-4 outline-none focus:border-[#0b6b4f] focus:ring-4 focus:ring-[#0b6b4f]/10"/></span></label>
        <button disabled={loading} className="flex h-12 w-full items-center justify-center rounded-xl bg-[#08744f] font-semibold text-white hover:bg-[#075f42] disabled:opacity-60">{loading ? "Creating account…" : "Create student account"}</button>
      </form>
      <p className="mt-7 text-center text-sm text-muted-foreground">Already have an account? <Link href="/student/login" className="font-semibold text-[#08744f] hover:underline">Sign in</Link></p>
    </AuthShell>
  );
}
