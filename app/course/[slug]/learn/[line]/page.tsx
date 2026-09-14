import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LearnView } from "@/components/modes/LearnView";
import { findLine } from "@/lib/course/queries";
import { loadAllCourses, loadCourse } from "@/lib/course/load";

export const dynamicParams = false;

export function generateStaticParams() {
  return loadAllCourses().flatMap((course) =>
    course.lines.map((line) => ({ slug: course.meta.slug, line: line.id })));
}

export async function generateMetadata(props: PageProps<"/course/[slug]/learn/[line]">): Promise<Metadata> {
  const { slug, line } = await props.params;
  const course = loadCourse(slug);
  const found = course ? findLine(course, line) : undefined;
  return { title: course && found ? `Learn ${found.name}` : "Line not found" };
}

export default async function LearnPage(props: PageProps<"/course/[slug]/learn/[line]">) {
  const { slug, line } = await props.params;
  const course = loadCourse(slug);
  if (!course || !findLine(course, line)) notFound();
  return <LearnView tree={course} lineId={line} />;
}
