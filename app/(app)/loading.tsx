/**
 * What a page looks like in the moment between the click and the data.
 *
 * Every page in this group renders on the server, so a click used to show the
 * old page until the new one arrived whole — a wait with nothing to look at.
 * This boundary lets the shell paint the new page's frame at once: the header
 * band and the panels, in the same places the real ones land, so the eye is
 * already where the numbers will appear. It is a still frame, not a shimmer;
 * reading a number must never wait on an animation, and neither should its
 * placeholder.
 *
 * It also makes the sidebar's ordinary prefetch worth something: a dynamic
 * page prefetches only as far as its loading boundary, and before this file
 * there was none.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="border-b px-6 py-5" style={{ borderColor: "var(--line)" }}>
        <Bar width="9rem" height="15px" />
        <Bar width="34rem" height="13px" className="mt-2.5" />
      </div>

      <div className="flex flex-col gap-5 p-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div
              key={index}
              className="rounded-[var(--radius-panel)] border px-4 py-3"
              style={{ borderColor: "var(--line)", background: "var(--panel)" }}
            >
              <Bar width="6rem" height="11px" />
              <Bar width="4rem" height="20px" className="mt-2.5" />
            </div>
          ))}
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {[0, 1].map((index) => (
            <div
              key={index}
              className="rounded-[var(--radius-panel)] border"
              style={{ borderColor: "var(--line)", background: "var(--panel)" }}
            >
              <div className="border-b px-4 py-3" style={{ borderColor: "var(--line)" }}>
                <Bar width="10rem" height="13px" />
              </div>
              <div className="flex flex-col gap-3 px-4 py-4">
                <Bar width="100%" height="11px" />
                <Bar width="88%" height="11px" />
                <Bar width="94%" height="11px" />
                <Bar width="70%" height="11px" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Bar({ width, height, className = "" }: { width: string; height: string; className?: string }) {
  return (
    <div
      className={`rounded ${className}`}
      style={{ width, height, maxWidth: "100%", background: "var(--viz-track)" }}
    />
  );
}
