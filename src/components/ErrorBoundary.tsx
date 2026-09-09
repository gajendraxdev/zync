import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Reset this subtree instead of reloading the whole window. */
  isolate?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private reset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      const showStack = import.meta.env.DEV;
      return (
        <div className="p-4 m-4 bg-red-900/20 border border-red-500 rounded text-red-200">
          <h2 className="text-lg font-bold mb-2">Something went wrong</h2>
          <p className="text-sm text-red-200/80 mb-2">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          {showStack && (
            <pre className="text-xs overflow-auto p-2 bg-black/50 rounded">
              {this.state.error?.stack}
            </pre>
          )}
          <button
            className="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-white"
            onClick={() => {
              if (this.props.isolate) this.reset();
              else window.location.reload();
            }}
          >
            {this.props.isolate ? 'Try again' : 'Reload App'}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
