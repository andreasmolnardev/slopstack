import { createFileRoute, redirect } from '@tanstack/react-router';
import { pb } from '../api/pocketbase';
import { Starburst } from '../starburst';

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === 'string' && search.redirect.startsWith('/') && !search.redirect.startsWith('//') ? search.redirect : undefined,
  }),
  beforeLoad: ({ search }) => {
    if (pb.authStore.isValid) throw redirect({ href: search.redirect ?? '/' });
  },
  component: LoginRoute,
});

function LoginRoute() {
  const { redirect: redirectTo } = Route.useSearch();
  return <Starburst redirectTo={redirectTo} />;
}
