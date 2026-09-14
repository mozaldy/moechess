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
  return <ExploreView tree={course} />;
}
