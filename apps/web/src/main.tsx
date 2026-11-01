import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '@slopstack/ui/components/ui/tooltip';
import { Toaster } from '@slopstack/ui/components/ui/sonner';
import { App } from './app';
import { slopstackRuntime } from './application';
import '@slopstack/ui/styles.css';

const queryClient = new QueryClient();
void slopstackRuntime.registry;

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      themes={['light', 'dark']}
    >
      <TooltipProvider>
        <App />
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>,
);
