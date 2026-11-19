import { createFileRoute, redirect } from '@tanstack/react-router';
import { pb } from '../api/pocketbase';
import { learningQueryOptions } from '../api/learning-queries';
import { Starburst } from '../starburst';

export const Route = createFileRoute('/')({
  beforeLoad: ({ location }) => {
    if (!pb.authStore.isValid) throw redirect({ to: '/login', search: { redirect: location.href } });
  },
  loader: ({ context }) => Promise.all([
    context.queryClient.ensureQueryData(learningQueryOptions.courses()),
    context.queryClient.ensureQueryData(learningQueryOptions.knowledgeUnits()),
  ]),
  component: Starburst,
});
