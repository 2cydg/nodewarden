import { render } from 'preact';
import { Router } from 'wouter';
import { basePath, installBasePathFetch } from './lib/base-path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { initI18n } from './lib/i18n';
import { registerNodeWardenServiceWorker } from './lib/pwa';
import './tailwind.css';

installBasePathFetch();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

const root = document.getElementById('root')!;
root.setAttribute('translate', 'no');

function renderApp(): void {
  render(
    <QueryClientProvider client={queryClient}>
      <Router base={basePath}><App /></Router>
    </QueryClientProvider>,
    root
  );
}

void initI18n().finally(() => {
  renderApp();
  registerNodeWardenServiceWorker();
});
