import { Component, type ErrorInfo, type ReactNode } from 'react';
import { InlineError } from '@/components/ui/States';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional label shown above the retry control. */
  fallbackMessage?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Isolates a crash in Vehículos / reservas / desplegables so React does not
 * unmount the whole marketplace and bounce the driver to Home.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('[derteapp2] recovered from', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      const message =
        this.props.fallbackMessage ??
        this.state.error.message ??
        'Algo ha fallado. La sesión sigue abierta.';
      return (
        <div className="p-4" data-error-boundary-fallback>
          <InlineError message={message} onRetry={() => this.setState({ error: null })} />
        </div>
      );
    }
    return this.props.children;
  }
}
