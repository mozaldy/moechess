import type { Metadata } from "next";
import { ReviewView } from "@/components/modes/ReviewView";
import { loadAllCourses } from "@/lib/course/load";

export const metadata: Metadata = { title: "Review" };

export default function ReviewPage() {
  return <ReviewView trees={loadAllCourses()} />;
}
