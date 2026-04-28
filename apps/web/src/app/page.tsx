import Link from 'next/link';

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-green-900 to-green-700 text-white p-8">
      <h1 className="text-6xl font-bold mb-4">Baseball Czar</h1>
      <p className="text-xl text-green-200 mb-12 text-center max-w-lg">
        Build your dynasty. Draft players, manage your roster, and compete against other GMs.
      </p>
      <div className="flex gap-4">
        <Link
          href="/login"
          className="rounded-lg bg-white text-green-900 font-semibold px-8 py-3 hover:bg-green-100 transition-colors"
        >
          Log In
        </Link>
        <Link
          href="/signup"
          className="rounded-lg border-2 border-white font-semibold px-8 py-3 hover:bg-white/10 transition-colors"
        >
          Sign Up
        </Link>
      </div>
      <Link
        href="/dashboard"
        className="mt-6 text-green-200 underline hover:text-white transition-colors"
      >
        Go to Dashboard →
      </Link>
    </div>
  );
}
