import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from './components/ui/tooltip';
import { Toaster } from './components/ui/sonner';
import { App } from './app';
import './styles.css';

const queryClient = new QueryClient();

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
