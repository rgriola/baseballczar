export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white">Baseball Czar</h1>
          <p className="mt-2 text-sm text-gray-400">Own. Manage. Dominate.</p>
        </div>
        {children}
      </div>
    </div>
  );
}
