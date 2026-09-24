import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExploreView } from "@/components/modes/ExploreView";
import { listCourseSlugs, loadCourse } from "@/lib/course/load";

export const dynamicParams = false;

export function generateStaticParams() {
  return listCourseSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata(props: PageProps<"/course/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  return { title: loadCourse(slug)?.meta.name ?? "Course not found" };
}

export default async function CoursePage(props: PageProps<"/course/[slug]">) {
  const { slug } = await props.params;
  const course = loadCourse(slug);
  if (!course) notFound();
  const query = await props.searchParams;
  const initialNodeId = typeof query.node === "string" && Object.hasOwn(course.nodes, query.node)
    ? query.node : undefined;
  const orientation = query.side === "white" || query.side === "black" ? query.side : undefined;
  return <ExploreView tree={course} initialNodeId={initialNodeId} orientation={orientation} />;
}
