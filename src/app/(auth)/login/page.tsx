'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { login } from '../actions';

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(
    async (_prev: { error?: string } | undefined, formData: FormData) => {
      return await login(formData);
    },
    undefined,
  );

  return (
    <form action={formAction} className="space-y-6 rounded-lg bg-gray-900 p-8 shadow-xl">
      <h2 className="text-xl font-semibold text-white">Sign In</h2>

      {state?.error && (
        <div className="rounded bg-red-900/50 p-3 text-sm text-red-300">{state.error}</div>
      )}

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-300">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-300">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          minLength={6}
          className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {pending ? 'Signing in...' : 'Sign In'}
      </button>

      <div className="flex justify-between text-sm">
        <Link href="/signup" className="text-blue-400 hover:text-blue-300">
          Create account
        </Link>
        <Link href="/reset-password" className="text-gray-400 hover:text-gray-300">
          Forgot password?
        </Link>
      </div>
    </form>
  );
}
