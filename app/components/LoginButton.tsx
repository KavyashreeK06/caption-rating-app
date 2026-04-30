"use client";

import { createBrowserClient } from "@supabase/ssr";

export default function LoginButton() {
  const handleLogin = async () => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      alert(error.message);
    }
  };

  return (
    <button
      type="button"
      onClick={handleLogin}
      className="rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-900"
    >
      Sign in with Google
    </button>
  );
}