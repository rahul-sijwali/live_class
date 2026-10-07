/**
 * Landing page: explains the demo and links to the two entry points.
 *
 * @returns {JSX.Element} Static content.
 */
export default function HomePage(): React.JSX.Element {
  return (
    <div className="demo-page">
      <h1>Live Class demo</h1>
      <p>
        A shared maths worksheet for one mentor and one student. Sign in with one of the seeded
        accounts, set up a session as the admin, then open the room as the mentor in one browser and
        as the student in another.
      </p>
      <ol>
        <li>
          <a href="/login/">Sign in</a> as <code>admin@local.test</code> and create a session with a
          mentor and a student.
        </li>
        <li>Open the room from the admin page, or share its link with both participants.</li>
        <li>
          Sign in as <code>mentor@local.test</code> and <code>student@local.test</code> in two
          browsers (or a private window) and write on the same sheet.
        </li>
      </ol>
    </div>
  );
}
