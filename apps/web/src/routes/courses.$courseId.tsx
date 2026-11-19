import { createFileRoute, redirect } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { pb } from '../api/pocketbase';
import { learningQueryOptions } from '../api/learning-queries';
import { Starburst } from '../starburst';

export const Route = createFileRoute('/courses/$courseId')({
  beforeLoad: ({ location }) => {
    if (!pb.authStore.isValid) throw redirect({ to: '/login', search: { redirect: location.href } });
  },
  loader: ({ context, params }) => context.queryClient.ensureQueryData(learningQueryOptions.course(params.courseId)),
  component: CourseRoute,
});

function CourseRoute() {
  const { courseId } = Route.useParams();
  const course = useQuery(learningQueryOptions.course(courseId));

  if (course.isPending) {
    return <main className="min-h-screen bg-[#0e0621] p-8 text-[#f8f5fc]" aria-live="polite">Loading course…</main>;
  }
  if (course.error) throw course.error;

  return <Starburst initialCourse={course.data} />;
}
