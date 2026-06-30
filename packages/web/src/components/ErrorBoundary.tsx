import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { error: Error | null }

/**
 * App-level error boundary. A thrown render in any module surfaces as a contained,
 * recoverable panel rather than a blank screen (Toyota baseline: it fails
 * gracefully and is diagnosable). Resetting re-mounts the subtree.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // No PII is ever in render props; safe to log the technical error for diagnosis.
    console.error("[hros] render error:", error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div role="alert" className="m-4 rounded-card border border-bad/40 bg-surface p-6">
          <h2 className="text-base font-bold text-ink">Something went wrong on this screen</h2>
          <p className="mt-1 text-sm text-muted">
            The rest of the app is unaffected. You can retry this view.
          </p>
          <pre className="mt-3 max-w-full overflow-x-auto rounded bg-ink/5 p-3 text-xs text-muted">{this.state.error.message}</pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-3 rounded border border-line px-3 py-1.5 text-sm font-semibold text-brand-navy hover:bg-ink/5"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
