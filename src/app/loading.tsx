export default function Loading() {
  return (
    <main className="terminal">
      <div className="routeLoadingShell" role="status" aria-live="polite">
        <div className="korraLoadingCore">
          <div className="korraLoadingSpinner" aria-hidden="true" />
          <span className="korraLoadingText">Loading trading bot</span>
        </div>
      </div>
    </main>
  );
}
