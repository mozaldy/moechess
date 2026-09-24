import { AssessmentClient } from "@/components/assessment/AssessmentClient";
import { loadAllCourses } from "@/lib/course/load";

export default function AssessmentPage() {
  return <AssessmentClient courses={loadAllCourses()} />;
}
