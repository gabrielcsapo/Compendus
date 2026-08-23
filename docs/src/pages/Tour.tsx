import { Link } from "react-router";
import { PRODUCT_FRAME_CLASS } from "@app/lib/product-ui";
import { iosShowcaseScenes, webShowcaseScenes, type ShowcaseTheme } from "../../../showcase/scenes";

const [library, detail, reader, audio, mobileWeb] = webShowcaseScenes;
const [iphoneLibrary, iphoneAudio, ipadLibrary] = iosShowcaseScenes;

function imageUrl(path: string) {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
}

export default function Tour() {
  return (
    <div className="overflow-hidden">
      <section className={`${PRODUCT_FRAME_CLASS} pb-16 pt-16 sm:pb-24 sm:pt-24`}>
        <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:items-end lg:gap-16">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-primary">
              A day with your library
            </p>
            <h1 className="mt-5 text-5xl font-extrabold leading-[0.93] tracking-[-0.065em] text-foreground sm:text-6xl lg:text-7xl">
              From the shelf to the last page.
            </h1>
          </div>
          <div className="lg:pb-1">
            <p className="max-w-2xl text-lg leading-8 text-foreground-muted sm:text-xl">
              Compendus keeps the library calm while every format retains its character. Follow a
              book from discovery to reading, then carry the same collection onto iPhone and iPad.
            </p>
            <div className="mt-7 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.14em] text-primary-muted">
              <span className="h-2 w-2 rounded-full bg-accent" />
              Captured from the real apps
            </div>
          </div>
        </div>
      </section>

      <section className={`${PRODUCT_FRAME_CLASS} pb-24`}>
        <BrowserFrame image={library.image} title="compendus.local/library" theme={library.theme} />
        <SceneCopy
          number="01"
          eyebrow={library.eyebrow}
          title={library.title}
          description={library.description}
          className="mt-10 lg:ml-[12%]"
        />
      </section>

      <section className="border-y border-border bg-surface/55">
        <div className={`${PRODUCT_FRAME_CLASS} py-20 sm:py-28`}>
          <div className="relative grid gap-16 lg:grid-cols-2 lg:items-center lg:gap-20">
            <SceneCopy
              number="02"
              eyebrow={detail.eyebrow}
              title={detail.title}
              description={detail.description}
            />
            <div className="lg:translate-x-[8%]">
              <BrowserFrame image={detail.image} title="The Great Gatsby" theme={detail.theme} />
            </div>
          </div>
        </div>
      </section>

      <section className={`${PRODUCT_FRAME_CLASS} py-20 sm:py-28`}>
        <div className="grid gap-12 lg:grid-cols-[1.32fr_0.68fr] lg:items-center lg:gap-20">
          <BrowserFrame
            image={reader.image}
            title="Reading · The Great Gatsby"
            theme={reader.theme}
          />
          <SceneCopy
            number="03"
            eyebrow={reader.eyebrow}
            title={reader.title}
            description={reader.description}
          />
        </div>
      </section>

      <section className="bg-[#08120f] text-white">
        <div className={`${PRODUCT_FRAME_CLASS} py-20 sm:py-28`}>
          <div className="grid gap-12 lg:grid-cols-[0.62fr_1.38fr] lg:items-center lg:gap-20">
            <SceneCopy
              number="04"
              eyebrow={audio.eyebrow}
              title={audio.title}
              description={audio.description}
              inverse
            />
            <BrowserFrame image={audio.image} title="Now listening" theme={audio.theme} />
          </div>
        </div>
      </section>

      <section className={`${PRODUCT_FRAME_CLASS} py-20 sm:py-28`}>
        <div className="mx-auto max-w-5xl text-center">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-primary">One library</p>
          <h2 className="mt-4 text-4xl font-extrabold tracking-[-0.055em] text-foreground sm:text-6xl">
            It meets you at the screen you have.
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-foreground-muted">
            Native where it matters, familiar everywhere. Progress and organization stay coherent
            without forcing every device into the same layout.
          </p>
        </div>

        <div className="relative mt-16 grid items-end gap-10 sm:grid-cols-3 sm:gap-6 lg:gap-14">
          <DeviceFrame kind="iphone" image={iphoneLibrary.image} label="iPhone · Library" />
          <DeviceFrame kind="iphone" image={iphoneAudio.image} label="iPhone · Audiobooks" />
          <DeviceFrame kind="mobile-web" image={mobileWeb.image} label="Mobile web · Dark" />
        </div>

        <div className="mt-16 grid gap-10 lg:grid-cols-[0.68fr_1.32fr] lg:items-center lg:gap-20">
          <SceneCopy
            number="05"
            eyebrow={ipadLibrary.eyebrow}
            title={ipadLibrary.title}
            description={ipadLibrary.description}
          />
          <DeviceFrame kind="ipad" image={ipadLibrary.image} label="iPad · Library" />
        </div>
      </section>

      <section className="border-t border-border bg-surface/65">
        <div
          className={`${PRODUCT_FRAME_CLASS} flex flex-col gap-8 py-16 sm:flex-row sm:items-center sm:justify-between`}
        >
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">
              Your reading room
            </p>
            <h2 className="mt-3 text-3xl font-extrabold tracking-[-0.045em] text-foreground sm:text-4xl">
              Ready to make it yours?
            </h2>
          </div>
          <Link
            to="/docs/getting-started"
            className="inline-flex w-fit items-center rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white shadow-btn transition hover:-translate-y-0.5 hover:bg-primary-hover hover:shadow-btn-hover"
          >
            Set up Compendus
          </Link>
        </div>
      </section>
    </div>
  );
}

function SceneCopy({
  number,
  eyebrow,
  title,
  description,
  inverse = false,
  className = "",
}: {
  number: string;
  eyebrow: string;
  title: string;
  description: string;
  inverse?: boolean;
  className?: string;
}) {
  return (
    <div className={`grid max-w-2xl grid-cols-[2.75rem_1fr] gap-4 ${className}`}>
      <span className={`font-mono text-xs font-bold ${inverse ? "text-[#e0b844]" : "text-accent"}`}>
        {number}
      </span>
      <div>
        <p
          className={`text-xs font-bold uppercase tracking-[0.2em] ${inverse ? "text-[#9bd0bb]" : "text-primary"}`}
        >
          {eyebrow}
        </p>
        <h2
          className={`mt-3 text-3xl font-extrabold leading-[1.02] tracking-[-0.05em] sm:text-5xl ${inverse ? "text-white" : "text-foreground"}`}
        >
          {title}
        </h2>
        <p
          className={`mt-5 max-w-xl leading-7 ${inverse ? "text-white/65" : "text-foreground-muted"}`}
        >
          {description}
        </p>
      </div>
    </div>
  );
}

function BrowserFrame({
  image,
  title,
  theme,
}: {
  image: string;
  title: string;
  theme: ShowcaseTheme;
}) {
  const dark = theme === "dark";
  return (
    <figure
      className={`overflow-hidden rounded-[1.15rem] border shadow-[0_26px_80px_rgba(12,32,25,0.14)] ${dark ? "border-white/10 bg-[#101916]" : "border-border bg-surface"}`}
    >
      <div
        className={`flex h-9 items-center gap-2 border-b px-4 ${dark ? "border-white/10 bg-[#17211e]" : "border-border bg-surface-elevated"}`}
      >
        <span className="h-2 w-2 rounded-full bg-[#d7aa30]" />
        <span className={`h-2 w-2 rounded-full ${dark ? "bg-white/20" : "bg-primary/25"}`} />
        <span className={`h-2 w-2 rounded-full ${dark ? "bg-white/10" : "bg-primary/15"}`} />
        <span
          className={`ml-2 truncate font-mono text-[9px] ${dark ? "text-white/40" : "text-foreground-muted"}`}
        >
          {title}
        </span>
      </div>
      <img src={imageUrl(image)} alt={title} className="block h-auto w-full" loading="lazy" />
    </figure>
  );
}

function DeviceFrame({
  image,
  label,
  kind,
}: {
  image: string;
  label: string;
  kind: "iphone" | "ipad" | "mobile-web";
}) {
  const isTablet = kind === "ipad";
  return (
    <figure className={isTablet ? "w-full" : "mx-auto w-full max-w-[19rem]"}>
      <div
        className={`overflow-hidden border-[5px] border-[#14221d] bg-[#14221d] shadow-[0_28px_70px_rgba(12,32,25,0.18)] ${
          isTablet ? "rounded-[1.8rem]" : "rounded-[2.4rem]"
        }`}
      >
        <img src={imageUrl(image)} alt={label} className="block h-auto w-full" loading="lazy" />
      </div>
      <figcaption className="mt-4 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-foreground-muted">
        {label}
      </figcaption>
    </figure>
  );
}
