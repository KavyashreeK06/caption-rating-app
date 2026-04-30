import Link from "next/link";
import LoginButton from "./components/LoginButton";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-16 text-slate-900">
      <section className="mx-auto max-w-3xl rounded-3xl bg-white p-10 shadow-sm">
        <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-indigo-600">
          Project 1
        </p>

        <h1 className="text-4xl font-bold tracking-tight">
          Caption Rating App
        </h1>

        <p className="mt-4 text-lg leading-8 text-slate-600">
          Browse AI-generated captions, sign in with Google, and vote on the
          captions you think are funniest or most effective.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/list"
            className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            View Captions
          </Link>

          <LoginButton />
        </div>
      </section>
    </main>
  );
}