import type { Metadata } from "next";
import { loadAllCourses } from "@/lib/course/load";
import type { Credit } from "@/lib/course/types";
import { PIECE_SETS } from "@/lib/theme/skins";

export const metadata: Metadata = { title: "Credits" };

const FONT_CREDITS: Credit[] = [
  { label: "Display type: Dela Gothic One", author: "artakana", url: "https://fonts.google.com/specimen/Dela+Gothic+One", license: "SIL Open Font License 1.1" },
  { label: "Text type: Atkinson Hyperlegible Next", author: "Braille Institute", url: "https://fonts.google.com/specimen/Atkinson+Hyperlegible+Next", license: "SIL Open Font License 1.1" },
];

function CreditItem({ credit }: { credit: Credit }) {
  return (
    <li className="mc-panel">
      <h2 className="mc-panel-heading">{credit.label}</h2>
      <p>
        {credit.author && <>{credit.author}. </>}
        License: {credit.license}.
      </p>
      {credit.url && <a href={credit.url}>View source</a>}
    </li>
  );
}

export default function CreditsPage() {
  const courses = loadAllCourses();
  return (
    <>
      <h1 className="mc-page-title">Credits</h1>
      <p className="mc-page-intro">
        Course notes are shared under each course&apos;s content license. The Moechess code is separate from this content.
      </p>
      <ul className="mc-credits">
        {courses.map((course) => (
          <li key={course.meta.slug} className="mc-panel">
            <h2 className="mc-panel-heading">{course.meta.name}</h2>
            <p>Content license: {course.meta.contentLicense}.</p>
            <ul className="mc-credits">
              {course.meta.credits.map((credit) => <CreditItem key={credit.label} credit={credit} />)}
            </ul>
          </li>
        ))}
        {Object.values(PIECE_SETS).map((set) => <CreditItem key={set.id} credit={set.credit} />)}
        {FONT_CREDITS.map((credit) => <CreditItem key={credit.label} credit={credit} />)}
      </ul>
    </>
  );
}
