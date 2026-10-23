import { Component, type ReactNode } from 'react';

/** Keeps the rest of the app usable if WebGL fails (old GPU, lost context…). */
export class ViewportBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm font-medium">O viewport 3D não pôde ser iniciado.</p>
        <p className="max-w-md text-xs text-muted">{this.state.error.message} — verifique se o WebGL está ativado no navegador. Importar, cortar e exportar continuam funcionando.</p>
        <button className="mt-2 rounded-md bg-surface-3 px-3 py-1.5 text-xs hover:bg-line" onClick={() => this.setState({ error: null })}>
          Tentar de novo
        </button>
      </div>
    );
  }
}
