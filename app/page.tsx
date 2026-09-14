import { CourseList } from "@/components/home/CourseList";
import { loadAllCourses } from "@/lib/course/load";

export default function HomePage() {
  const courses = loadAllCourses();
  return (
    <>
      <h1 className="mc-page-title">Learn an opening one line at a time</h1>
      <p className="mc-page-intro">
        Explore a line with notes, play it until you know it, then keep it fresh with short reviews.
      </p>
      <CourseList courses={courses} />
    </>
  );
}
