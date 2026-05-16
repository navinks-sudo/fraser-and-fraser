import React from 'react';

/**
 * App-wide error boundary. Catches synchronous render errors in the tree
 * so they don't unmount silently into a blank page. Renders a friendly
 * fallback with the actual error message so we can diagnose mid-session.
 */
class ErrorBoundary extends React.Component {
  state = { error: null, info: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // Also surface to console for stack trace
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] caught', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const stack =
      this.state.error.stack ||
      this.state.info?.componentStack ||
      String(this.state.error);
    return (
      <div className="min-h-screen bg-surface-canvas px-8 py-12">
        <div className="max-w-3xl mx-auto bg-surface border border-red-200 rounded-md p-7 shadow-warm-sm">
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-red-600 mb-2">
            Something broke on this page
          </div>
          <h1 className="font-display font-extrabold text-2xl text-navy-800 mb-3">
            {this.state.error.message || 'Unknown render error'}
          </h1>
          <p className="text-[14px] text-ink-secondary leading-relaxed mb-5">
            The page hit an unexpected error. Open the browser dev console for
            the full stack, or share the trace below with whoever's debugging.
          </p>
          <pre className="bg-surface-raised border border-line-subtle rounded p-4 text-[11px] font-mono text-navy-800 overflow-auto max-h-[420px] whitespace-pre-wrap">
{stack}
          </pre>
          <div className="flex gap-3 mt-5">
            <button
              onClick={() => { this.setState({ error: null, info: null }); window.location.reload(); }}
              className="btn-orange text-[13px]"
            >
              Reload page
            </button>
            <button
              onClick={() => { this.setState({ error: null, info: null }); window.history.back(); }}
              className="btn-secondary text-[13px]"
            >
              Go back
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
