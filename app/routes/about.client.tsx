"use client";

import { Link } from "react-flight-router/client";
import { CompendusLogo } from "../components/CompendusLogo";

const principles = [
  {
    number: "01",
    title: "Your shelf, not a feed",
    body: "The books you chose stay at the center. No engagement loops, sponsored shelves, or algorithmic noise.",
  },
  {
    number: "02",
    title: "One quiet reading room",
    body: "Ebooks, audiobooks, PDFs, and comics share a single library without losing what makes each format useful.",
  },
  {
    number: "03",
    title: "Yours to keep",
    body: "Compendus is self-hosted and open source, so your collection, progress, notes, and reading history remain yours.",
  },
];

export default function Component() {
  return (
    <main className="mx-auto max-w-7xl px-5 pb-20 pt-14 sm:px-8 lg:px-11 lg:pt-20">
      <section className="max-w-5xl">
        <div className="mb-8 flex items-center gap-3">
          <CompendusLogo className="h-9 w-9" />
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
            About Compendus
          </p>
        </div>
        <h1 className="max-w-4xl text-5xl font-extrabold leading-[0.96] tracking-[-0.06em] text-foreground sm:text-6xl lg:text-8xl">
          A home for books—and the life around them.
        </h1>
        <p className="mt-7 max-w-2xl text-lg leading-8 text-foreground-muted sm:text-xl">
          Compendus is a personal reading library built to make opening a book feel easier than
          managing one.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <Link
            to="/library"
            className="rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
          >
            Open your library
          </Link>
          <a
            href="https://github.com/gabrielcsapo/Compendus"
            className="rounded-xl border border-border px-5 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-surface-elevated"
          >
            View the project
          </a>
        </div>
      </section>

      <section className="mt-20 border-t border-border pt-8 lg:mt-28">
        <div className="grid gap-10 md:grid-cols-3 md:gap-8">
          {principles.map((principle) => (
            <article key={principle.number} className="border-t border-border pt-5">
              <p className="text-xs font-bold tracking-[0.16em] text-primary">{principle.number}</p>
              <h2 className="mt-8 text-2xl font-bold tracking-[-0.03em] text-foreground">
                {principle.title}
              </h2>
              <p className="mt-3 max-w-sm leading-7 text-foreground-muted">{principle.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-20 rounded-2xl bg-[#15251f] px-6 py-8 text-[#f4f3ed] sm:px-9 sm:py-10 lg:flex lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#9fcfbc]">
            Read your way
          </p>
          <h2 className="mt-3 max-w-2xl text-3xl font-bold tracking-[-0.04em] sm:text-4xl">
            EPUB · PDF · M4B · MP3 · CBZ · CBR
          </h2>
        </div>
        <p className="mt-6 max-w-md leading-7 text-[#b8c1bd] lg:mt-0 lg:text-right">
          Web, iPhone, iPad, and CarPlay—designed as one thoughtful reading experience.
        </p>
      </section>
    </main>
  );
}
