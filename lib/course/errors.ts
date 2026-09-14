export class CourseValidationError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Course content is invalid:\n- ${problems.join("\n- ")}`);
    this.name = "CourseValidationError";
    this.problems = problems;
  }
}
