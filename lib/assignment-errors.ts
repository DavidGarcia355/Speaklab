export class AssignmentPointsBelowSavedGradeError extends Error {
  readonly highestSavedGrade: number;

  constructor(highestSavedGrade: number) {
    super(
      `Points possible cannot be lower than the saved grade of ${highestSavedGrade}. Update or clear that grade first.`
    );
    this.name = "AssignmentPointsBelowSavedGradeError";
    this.highestSavedGrade = highestSavedGrade;
  }
}
