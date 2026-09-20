export function ErrorState({
  message = 'Data for this panel is temporarily unavailable.',
  onRetry,
}: {
  message?: string
  onRetry?: () => void
}) {
  return (
    <div className="state-error" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}

export function LoadingState({ label = 'Loading data…' }: { label?: string }) {
  return (
    <p className="state-loading" role="status">
      {label}
    </p>
  )
}
