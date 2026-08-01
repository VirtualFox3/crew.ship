import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { Spinner } from "@/components/ui";

export const metadata: Metadata = { title: "Create your account" };

export default function SignupPage() {
  return (
    <Suspense fallback={<Centered />}>
      <AuthForm mode="signup" />
    </Suspense>
  );
}

function Centered() {
  return (
    <div className="grid min-h-screen place-items-center text-ink-500">
      <Spinner className="size-6" />
    </div>
  );
}
