export function LoadingOverlay({ message = "Loading Data from Battle.net" }: { message?: string }) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-900/95"
      aria-live="polite"
      aria-busy="true"
    >
      <div
        className="h-12 w-12 rounded-full border-4 border-slate-600 border-t-amber-500 animate-spin"
        role="status"
        aria-hidden="true"
      />
      <p className="mt-5 text-lg font-medium text-slate-200">{message}</p>
    </div>
  );
}
