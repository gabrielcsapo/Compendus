import { Link } from "react-router";
import { CodeBlock } from "@app/components/docs";
import { PRODUCT_FRAME_CLASS } from "@app/lib/product-ui";
import { supportedFormats } from "@app/lib/api/spec";
import { ShowcaseBookCard } from "../components/ShowcaseBookCard";
import { mockBooks } from "../data/mockBooks";

const shelfBooks = [mockBooks[0], mockBooks[3], mockBooks[4]];

const readingPrinciples = [
  {
    label: "Own the shelf",
    title: "Your files remain yours.",
    body: "Keep ebooks, audiobooks, comics, progress, highlights, and listening history on infrastructure you control.",
  },
  {
    label: "Pick up anywhere",
    title: "Web and native reading stay in step.",
    body: "Move between the responsive web reader, iPhone, iPad, and CarPlay without losing your place.",
  },
  {
    label: "Keep the room quiet",
    title: "Power stays out of the way.",
    body: "Search, metadata, transcription, text-to-speech, and organization support the book instead of competing with it.",
  },
];

const sourceNotes = [
  "Color and spacing come directly from the app theme.",
  "The shelf below uses the production BookObject interaction.",
  "API reference pages render from the application specification.",
];

export default function Landing() {
  const formats = supportedFormats.books.extensions.map((extension) =>
    extension.replace(".", "").toUpperCase(),
  );

  return (
    <div className="overflow-hidden">
      <section className={`${PRODUCT_FRAME_CLASS} py-16 sm:py-24 lg:py-28`}>
        <div className="grid items-center gap-14 lg:grid-cols-[0.78fr_1.22fr] lg:gap-16">
          <div>
            <p className="mb-5 text-xs font-bold uppercase tracking-[0.2em] text-primary">
              Your self-hosted reading room
            </p>
            <h1 className="max-w-3xl text-5xl font-extrabold leading-[0.94] tracking-[-0.065em] text-foreground sm:text-6xl lg:text-7xl">
              Make a little room for the books you already own.
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-foreground-muted sm:text-xl">
              Compendus brings ebooks, audiobooks, and comics into one calm library—ready on the
              web, iPhone, iPad, and in the car.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                to="/docs/getting-started"
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white shadow-btn transition hover:-translate-y-0.5 hover:bg-primary-hover hover:shadow-btn-hover"
              >
                Set up Compendus
                <ArrowIcon />
              </Link>
              <a
                href="https://github.com/gabrielcsapo/Compendus"
                className="inline-flex items-center rounded-xl border border-border bg-surface px-5 py-3 text-sm font-bold text-foreground transition hover:border-border-hover hover:bg-surface-elevated"
              >
                View the source
              </a>
            </div>
          </div>

          <ProductShelf />
        </div>
      </section>

      <div className={`${PRODUCT_FRAME_CLASS}`}>
        <div className="docs-rule h-px" />
      </div>

      <section id="reading" className={`${PRODUCT_FRAME_CLASS} py-20 sm:py-28`}>
        <div className="grid gap-12 lg:grid-cols-[0.7fr_1.3fr] lg:gap-20">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">
              Reading is the feature
            </p>
            <h2 className="reading-title mt-4 max-w-md text-4xl leading-[1.04] text-foreground sm:text-5xl">
              A library should make you want to open a book.
            </h2>
          </div>
          <div className="divide-y divide-border border-y border-border">
            {readingPrinciples.map((principle) => (
              <article
                key={principle.label}
                className="grid gap-3 py-7 sm:grid-cols-[10rem_1fr] sm:py-8"
              >
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary-muted">
                  {principle.label}
                </p>
                <div>
                  <h3 className="text-xl font-bold tracking-[-0.025em] text-foreground">
                    {principle.title}
                  </h3>
                  <p className="mt-2 max-w-2xl leading-7 text-foreground-muted">{principle.body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="formats" className="border-y border-border bg-surface/65">
        <div className={`${PRODUCT_FRAME_CLASS} py-20 sm:py-24`}>
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">
                One shelf, every format
              </p>
              <h2 className="mt-4 max-w-xl text-4xl font-extrabold tracking-[-0.05em] text-foreground sm:text-5xl">
                The format changes. The calm does not.
              </h2>
            </div>
            <p className="max-w-2xl text-lg leading-8 text-foreground-muted lg:justify-self-end">
              Hover the covers above: ebooks open by their spine, an audiobook reveals its disc, and
              comics separate into print layers. These are the same format-gated interactions used
              by the product.
            </p>
          </div>

          <div className="mt-12 flex flex-wrap gap-2" aria-label="Supported formats">
            {formats.map((format) => (
              <span
                key={format}
                className="rounded-full border border-border bg-background px-3 py-1.5 font-mono text-xs font-bold text-foreground-muted"
              >
                {format}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className={`${PRODUCT_FRAME_CLASS} py-20 sm:py-28`}>
        <div className="quiet-panel overflow-hidden">
          <div className="grid lg:grid-cols-[0.85fr_1.15fr]">
            <div className="p-7 sm:p-10 lg:p-12">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">
                One source of truth
              </p>
              <h2 className="mt-4 text-3xl font-extrabold tracking-[-0.045em] text-foreground sm:text-4xl">
                The guide follows the product.
              </h2>
              <p className="mt-4 max-w-lg leading-7 text-foreground-muted">
                Shared tokens, brand components, physical covers, and API specifications keep the
                documentation honest as Compendus changes.
              </p>
              <ul className="mt-8 space-y-4">
                {sourceNotes.map((note) => (
                  <li key={note} className="flex gap-3 text-sm leading-6 text-foreground-muted">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    {note}
                  </li>
                ))}
              </ul>
            </div>
            <div className="border-t border-border bg-code-bg p-5 sm:p-8 lg:border-l lg:border-t-0">
              <CodeBlock language="bash">{`git clone https://github.com/gabrielcsapo/Compendus.git
cd Compendus
pnpm install
pnpm start`}</CodeBlock>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-primary text-white">
        <div
          className={`${PRODUCT_FRAME_CLASS} flex flex-col gap-7 py-14 sm:flex-row sm:items-center sm:justify-between`}
        >
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/65">
              Start with one shelf
            </p>
            <h2 className="mt-3 text-3xl font-extrabold tracking-[-0.04em] sm:text-4xl">
              Bring your library home.
            </h2>
          </div>
          <Link
            to="/docs/getting-started"
            className="inline-flex w-fit items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-[#184536] transition hover:-translate-y-0.5"
          >
            Read the setup guide
            <ArrowIcon />
          </Link>
        </div>
      </section>
    </div>
  );
}

function ProductShelf() {
  return (
    <div className="shelf-wash quiet-panel relative overflow-hidden p-5 sm:p-7 lg:p-8">
      <div className="mb-7 flex items-center justify-between border-b border-border pb-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Today</p>
          <p className="mt-1 text-sm font-semibold text-foreground">On your shelf</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-accent" />
          <span className="font-mono text-[10px] text-foreground-muted">3 formats</span>
        </div>
      </div>
      <div className="grid grid-cols-3 items-start gap-4 sm:gap-6">
        {shelfBooks.map((book) => (
          <ShowcaseBookCard key={book.title} book={book} />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-surface/55 to-transparent" />
    </div>
  );
}

function ArrowIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m9 5 7 7-7 7" />
    </svg>
  );
}
