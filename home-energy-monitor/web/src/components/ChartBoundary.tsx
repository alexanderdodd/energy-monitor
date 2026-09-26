import { Component, Suspense, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/**
 * Keeps a failing chart from taking the page with it.
 *
 * Charts are the one part of the UI running third-party rendering code, and
 * an uncaught error in a lazily loaded chunk unmounts everything above it.
 * A dashboard that loses its numbers because a canvas would not initialise is
 * a far worse outcome than a dashboard with one chart missing.
 */
export class ChartBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Chart failed to render", error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return <p className="chart-placeholder">This chart could not be displayed.</p>;
    }
    return (
      <Suspense fallback={<p className="chart-placeholder">Loading chart&hellip;</p>}>
        {this.props.children}
      </Suspense>
    );
  }
}
