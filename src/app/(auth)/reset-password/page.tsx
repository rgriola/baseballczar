'use client';

import { useFormState, useFormStatus } from 'react-dom';
import Link from 'next/link';
import { resetPassword } from '../actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
    >
      {pending ? 'Sending...' : 'Send Reset Link'}
    </button>
  );
}

export default function ResetPasswordPage() {
  const [state, formAction] = useFormState(
    async (_prev: { error?: string; success?: string } | undefined, formData: FormData) => {
      return await resetPassword(formData);
    },
    undefined,
  );

  return (
    <form action={formAction} className="space-y-6 rounded-lg bg-gray-900 p-8 shadow-xl">
      <h2 className="text-xl font-semibold text-white">Reset Password</h2>
      <p className="text-sm text-gray-400">
        Enter your email and we&apos;ll send you a link to reset your password.
      </p>

      {state?.error && (
        <div className="rounded bg-red-900/50 p-3 text-sm text-red-300">{state.error}</div>
      )}
      {state?.success && (
        <div className="rounded bg-green-900/50 p-3 text-sm text-green-300">{state.success}</div>
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

      <SubmitButton />

      <p className="text-center text-sm text-gray-400">
        <Link href="/login" className="text-blue-400 hover:text-blue-300">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
