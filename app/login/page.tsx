import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { Spinner } from "@/components/ui";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
  return (
    <Suspense fallback={<Centered />}>
      <AuthForm mode="login" />
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
