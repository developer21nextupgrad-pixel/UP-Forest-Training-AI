// "use client";
// import { FormEvent, useMemo, useState } from "react";
// import Link from "next/link";
// import { useSearchParams,useRouter } from "next/navigation";
// import { ArrowLeft, Check, Eye, EyeOff, LockKeyhole } from "lucide-react";
// import { AuthShell } from "@/components/auth/auth-shell";
// import { apiRequest } from "@/lib/api";
// export default function ResetPasswordPage(){const router=useRouter();const params=useSearchParams();const token=params.get("token")??"";const[password,setPassword]=useState("");const[confirm,setConfirm]=useState("");const[show,setShow]=useState(false);const[error,setError]=useState("");const[success,setSuccess]=useState(false);const[loading,setLoading]=useState(false);const checks=useMemo(()=>[/[A-Z]/.test(password),/[a-z]/.test(password),/\d/.test(password),password.length>=8],[password]);async function submit(e:FormEvent){e.preventDefault();setError("");if(!token){setError("This reset link is missing or invalid.");return}if(password!==confirm){setError("Passwords do not match.");return}if(!checks.every(Boolean)){setError("Please choose a stronger password.");return}setLoading(true);const r=await apiRequest("/api/v1/auth/reset-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token,new_password:password,confirm_password:confirm})});setLoading(false);if(!r.success){setError(r.message);return}setSuccess(true)}return <AuthShell eyebrow="Secure recovery" title="Create a new password" subtitle="Choose a strong password to protect your Forest Library account.">{success?<div className="space-y-5"><div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300"><p className="font-semibold">Password reset complete</p><p className="mt-1 leading-6">Your password has been updated. You can now sign in with your new password.</p></div><button onClick={()=>router.replace("/login?reset=1")} className="h-12 w-full rounded-xl bg-[#08744f] font-semibold text-white hover:bg-[#075f42]">Continue to Login</button></div>:<form onSubmit={submit} className="space-y-5">{error&&<div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">{error}</div>}<label className="block text-sm font-medium">New password<span className="relative mt-2 block"><LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><input required type={show?"text":"password"} value={password} onChange={e=>setPassword(e.target.value)} className="h-12 w-full rounded-xl border border-input bg-background pl-10 pr-12 outline-none focus:border-[#0b6b4f] focus:ring-4 focus:ring-[#0b6b4f]/10"/><button type="button" onClick={()=>setShow(v=>!v)} className="absolute right-2 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">{show?<EyeOff className="size-4"/>:<Eye className="size-4"/>}</button></span></label><div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">{[[checks[0],"Uppercase"],[checks[1],"Lowercase"],[checks[2],"Number"],[checks[3],"8+ characters"]].map(([ok,label])=><div key={label as string} className="flex items-center gap-2"><Check className={`size-3.5 ${ok?"text-[#08744f]":"text-muted-foreground/30"}`}/>{label as string}</div>)}</div><label className="block text-sm font-medium">Confirm password<span className="relative mt-2 block"><LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><input required type={show?"text":"password"} value={confirm} onChange={e=>setConfirm(e.target.value)} className="h-12 w-full rounded-xl border border-input bg-background pl-10 pr-4 outline-none focus:border-[#0b6b4f] focus:ring-4 focus:ring-[#0b6b4f]/10"/></span></label><button disabled={loading} className="h-12 w-full rounded-xl bg-[#08744f] font-semibold text-white hover:bg-[#075f42] disabled:opacity-60">{loading?"Resetting password…":"Reset password"}</button><Link href="/login" className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4"/> Back to Login</Link></form>}</AuthShell>}

"use client";

import { FormEvent, Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, Check, Eye, EyeOff, LockKeyhole } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { apiRequest } from "@/lib/api";

function ResetPasswordContent() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const checks = useMemo(
    () => [
      /[A-Z]/.test(password),
      /[a-z]/.test(password),
      /\d/.test(password),
      password.length >= 8,
    ],
    [password]
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!token) {
      setError("This reset link is missing or invalid.");
      return;
    }

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    if (!checks.every(Boolean)) {
      setError("Please choose a stronger password.");
      return;
    }

    setLoading(true);

    const r = await apiRequest("/api/v1/auth/reset-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token,
        new_password: password,
        confirm_password: confirm,
      }),
    });

    setLoading(false);

    if (!r.success) {
      setError(r.message);
      return;
    }

    setSuccess(true);
  }

  return (
    <AuthShell
      eyebrow="Secure recovery"
      title="Create a new password"
      subtitle="Choose a strong password to protect your Forest Library account."
    >
      {success ? (
        <div className="space-y-5">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
            <p className="font-semibold">Password reset complete</p>
            <p className="mt-1 leading-6">
              Your password has been updated. You can now sign in with your new
              password.
            </p>
          </div>

          <button
            onClick={() => router.replace("/login?reset=1")}
            className="h-12 w-full rounded-xl bg-[#08744f] font-semibold text-white hover:bg-[#075f42]"
          >
            Continue to Login
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          {error && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
            >
              {error}
            </div>
          )}

          <label className="block text-sm font-medium">
            New password

            <span className="relative mt-2 block">
              <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

              <input
                required
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 w-full rounded-xl border border-input bg-background pl-10 pr-12 outline-none focus:border-[#0b6b4f] focus:ring-4 focus:ring-[#0b6b4f]/10"
              />

              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute right-2 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
              >
                {show ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </span>
          </label>

          <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
            {[
              [checks[0], "Uppercase"],
              [checks[1], "Lowercase"],
              [checks[2], "Number"],
              [checks[3], "8+ characters"],
            ].map(([ok, label]) => (
              <div
                key={label as string}
                className="flex items-center gap-2"
              >
                <Check
                  className={`size-3.5 ${
                    ok ? "text-[#08744f]" : "text-muted-foreground/30"
                  }`}
                />
                {label as string}
              </div>
            ))}
          </div>

          <label className="block text-sm font-medium">
            Confirm password

            <span className="relative mt-2 block">
              <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

              <input
                required
                type={show ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="h-12 w-full rounded-xl border border-input bg-background pl-10 pr-4 outline-none focus:border-[#0b6b4f] focus:ring-4 focus:ring-[#0b6b4f]/10"
              />
            </span>
          </label>

          <button
            disabled={loading}
            className="h-12 w-full rounded-xl bg-[#08744f] font-semibold text-white hover:bg-[#075f42] disabled:opacity-60"
          >
            {loading ? "Resetting password…" : "Reset password"}
          </button>

          <Link
            href="/login"
            className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to Login
          </Link>
        </form>
      )}
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <AuthShell
          eyebrow="Secure recovery"
          title="Create a new password"
          subtitle="Loading password reset..."
        >
          <div className="h-12 w-full animate-pulse rounded-xl bg-muted" />
        </AuthShell>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}