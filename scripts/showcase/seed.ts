import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import AdmZip from "adm-zip";
import { eq } from "drizzle-orm";
import sharp from "sharp";

export const SHOWCASE_ROOT = resolve(process.cwd(), ".showcase");
export const SHOWCASE_DATA_DIR = resolve(SHOWCASE_ROOT, "data");
export const SHOWCASE_PROFILE_ID = "showcase-reader";

const booksDir = resolve(SHOWCASE_DATA_DIR, "books");
const coversDir = resolve(SHOWCASE_DATA_DIR, "covers");
const docsCoversDir = resolve(process.cwd(), "docs/public/covers");

const showcaseBooks = [
  {
    id: "showcase-gatsby",
    source: "generated-reader",
    fileName: "the-great-gatsby.epub",
    cover: "great-gatsby.jpg",
    mimeType: "application/epub+zip",
    title: "The Great Gatsby",
    subtitle: "A novel of impossible longing",
    authors: ["F. Scott Fitzgerald"],
    publisher: "Scribner",
    publishedDate: "1925-04-10",
    description:
      "A luminous portrait of reinvention, desire, and the distance between the life we live and the one we imagine.",
    isbn13: "9780743273565",
    language: "English",
    pageCount: 180,
    coverColor: "#173b64",
    progress: 0.73,
    rating: 5,
    lastPosition: JSON.stringify({ type: "epub", spineIndex: 4, progress: 0.73 }),
  },
  {
    id: "showcase-dune",
    source: "server/__fixtures__/epub/linear-algebra.epub",
    fileName: "dune.epub",
    cover: "dune.jpg",
    mimeType: "application/epub+zip",
    title: "Dune",
    subtitle: "Book one of the Dune Chronicles",
    authors: ["Frank Herbert"],
    publisher: "Ace",
    publishedDate: "1965-08-01",
    description:
      "A story of ecology, inheritance, faith, and power on the desert world of Arrakis.",
    isbn13: "9780441172719",
    language: "English",
    pageCount: 688,
    series: "Dune Chronicles",
    seriesNumber: "1",
    coverColor: "#9a5f21",
    progress: 0.45,
    rating: 5,
    lastPosition: JSON.stringify({ type: "epub", spineIndex: 2, progress: 0.45 }),
  },
  {
    id: "showcase-1984",
    source: "tests/fixtures/pdfs/with-images.pdf",
    fileName: "1984.pdf",
    cover: "1984.jpg",
    mimeType: "application/pdf",
    title: "1984",
    authors: ["George Orwell"],
    publisher: "Secker & Warburg",
    publishedDate: "1949-06-08",
    description: "A clear-eyed warning about language, memory, and the machinery of control.",
    isbn13: "9780451524935",
    language: "English",
    pageCount: 328,
    coverColor: "#7f1d1d",
    progress: 0.12,
    rating: 4,
    lastPosition: JSON.stringify({ type: "pdf", page: 38, progress: 0.12 }),
  },
  {
    id: "showcase-project-hail-mary",
    source: "tests/fixtures/sample.mp3",
    fileName: "project-hail-mary.mp3",
    cover: "project-hail-mary.jpg",
    mimeType: "audio/mpeg",
    title: "Project Hail Mary",
    authors: ["Andy Weir"],
    publisher: "Audible Studios",
    publishedDate: "2021-05-04",
    description:
      "A lone astronaut wakes far from home with an impossible problem and an unexpected companion.",
    isbn13: "9780593135204",
    language: "English",
    duration: 58200,
    narrator: "Ray Porter",
    chapters: JSON.stringify([
      { title: "Chapter 1", startTime: 0, endTime: 2460 },
      { title: "Chapter 2", startTime: 2460, endTime: 5160 },
      { title: "Chapter 3", startTime: 5160, endTime: 7920 },
      { title: "Chapter 4", startTime: 7920, endTime: 10620 },
    ]),
    coverColor: "#171c2d",
    progress: 0.22,
    rating: 5,
    lastPosition: JSON.stringify({ type: "audio", timestamp: 12804, progress: 0.22 }),
  },
  {
    id: "showcase-saga",
    source: "generated-comic",
    fileName: "saga-vol-1.cbz",
    cover: "saga-vol-1.jpg",
    mimeType: "application/vnd.comicbook+zip",
    title: "Saga Vol. 1",
    authors: ["Brian K. Vaughan", "Fiona Staples"],
    publisher: "Image Comics",
    publishedDate: "2012-10-10",
    description: "A family story told at impossible scale, intimate and strange in equal measure.",
    isbn13: "9781607066019",
    language: "English",
    pageCount: 160,
    series: "Saga",
    seriesNumber: "1",
    coverColor: "#61255e",
    progress: 1,
    rating: 5,
    isRead: true,
    lastPosition: JSON.stringify({ type: "comic", page: 160, progress: 1 }),
  },
  {
    id: "showcase-neuromancer",
    source: "server/__fixtures__/epub/haruko-html-jpeg.epub",
    fileName: "neuromancer.epub",
    cover: "neuromancer.jpg",
    mimeType: "application/epub+zip",
    title: "Neuromancer",
    authors: ["William Gibson"],
    publisher: "Ace",
    publishedDate: "1984-07-01",
    description: "A cold, bright descent into cyberspace and the people remade by it.",
    isbn13: "9780441569595",
    language: "English",
    pageCount: 271,
    coverColor: "#0e5664",
    progress: 0,
    rating: null,
    lastPosition: null,
  },
] as const;

function assertShowcasePath(path: string) {
  if (!path.startsWith(`${SHOWCASE_ROOT}/`)) {
    throw new Error(`Refusing to modify a path outside ${SHOWCASE_ROOT}`);
  }
}

function createShowcaseReaderEpub(destination: string) {
  const zip = new AdmZip();
  zip.addFile("mimetype", Buffer.from("application/epub+zip"));
  zip.addFile(
    "META-INF/container.xml",
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
  );

  const chapterTitles = [
    "West Egg",
    "The invitation",
    "Across the bay",
    "The city",
    "A house full of music",
    "Old names",
    "Heat",
    "The road home",
    "The green light",
    "Morning",
  ];
  const chapterItems = chapterTitles
    .map(
      (title, index) =>
        `<item id="chapter-${index + 1}" href="chapter-${index + 1}.xhtml" media-type="application/xhtml+xml"/>`,
    )
    .join("\n    ");
  const spineItems = chapterTitles
    .map((_, index) => `<itemref idref="chapter-${index + 1}"/>`)
    .join("\n    ");
  zip.addFile(
    "OEBPS/content.opf",
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">compendus-showcase-gatsby</dc:identifier>
    <dc:title>The Great Gatsby</dc:title>
    <dc:creator>F. Scott Fitzgerald</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-08-23T14:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${chapterItems}
  </manifest>
  <spine>${spineItems}</spine>
</package>`),
  );
  zip.addFile(
    "OEBPS/nav.xhtml",
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Contents</title></head><body>
<nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><ol>${chapterTitles
      .map((title, index) => `<li><a href="chapter-${index + 1}.xhtml">${title}</a></li>`)
      .join("")}</ol></nav></body></html>`),
  );

  for (const [index, title] of chapterTitles.entries()) {
    zip.addFile(
      `OEBPS/chapter-${index + 1}.xhtml`,
      Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body>
<h1>${String(index + 1).padStart(2, "0")} · ${title}</h1>
<p>The lights across the water appeared one by one, small promises held against the dark.</p>
<p>From the terrace, the music softened into conversation. Every open window seemed to frame another life.</p>
<p>He had built the evening carefully: white linen, cold glasses, and a garden bright enough to feel borrowed.</p>
<p>By midnight the last guests had gone. The house grew still, but the green light remained.</p>
<p>Some stories begin with arrival. This one kept returning to the distance between where we stand and where we hope to be.</p>
</body></html>`),
    );
  }
  zip.writeZip(destination);
}

async function prepareFiles() {
  assertShowcasePath(SHOWCASE_DATA_DIR);
  rmSync(SHOWCASE_DATA_DIR, { recursive: true, force: true });
  mkdirSync(booksDir, { recursive: true });
  mkdirSync(coversDir, { recursive: true });

  for (const book of showcaseBooks) {
    const destination = resolve(booksDir, book.fileName);
    if (book.source === "generated-comic") {
      const zip = new AdmZip();
      const page = readFileSync(resolve(docsCoversDir, book.cover));
      for (let index = 1; index <= 8; index += 1) {
        zip.addFile(`${String(index).padStart(3, "0")}.jpg`, page);
      }
      zip.writeZip(destination);
    } else if (book.source === "generated-reader") {
      createShowcaseReaderEpub(destination);
    } else {
      cpSync(resolve(process.cwd(), book.source), destination);
    }

    const sourceCover = resolve(docsCoversDir, book.cover);
    const coverDestination = resolve(coversDir, `${book.id}.jpg`);
    cpSync(sourceCover, coverDestination);
    await sharp(sourceCover)
      .resize(240, 360, { fit: "cover" })
      .jpeg({ quality: 86 })
      .toFile(resolve(coversDir, `${book.id}.thumb.jpg`));
  }
}

export async function seedShowcase() {
  await prepareFiles();
  process.env.COMPENDUS_DATA_DIR = SHOWCASE_DATA_DIR;

  const dbModule = await import("../../app/lib/db/index.js");
  const {
    db,
    rawDb,
    profiles,
    books,
    userBookState,
    collections,
    booksCollections,
    tags,
    booksTags,
    readingSessions,
  } = dbModule;
  const now = new Date("2026-08-23T14:00:00.000Z");

  db.insert(profiles)
    .values({
      id: SHOWCASE_PROFILE_ID,
      name: "Alex",
      avatar: "A",
      isAdmin: true,
      dailyGoalMinutes: 30,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  for (const [index, book] of showcaseBooks.entries()) {
    const filePath = resolve(booksDir, book.fileName);
    const createdAt = new Date(now.getTime() - index * 86_400_000);
    db.insert(books)
      .values({
        id: book.id,
        filePath: `data/books/${book.fileName}`,
        fileName: book.fileName,
        fileSize: statSync(filePath).size,
        fileHash: `showcase-${book.id}`,
        mimeType: book.mimeType,
        title: book.title,
        subtitle: "subtitle" in book ? book.subtitle : null,
        authors: JSON.stringify(book.authors),
        publisher: book.publisher,
        publishedDate: book.publishedDate,
        description: book.description,
        isbn13: book.isbn13,
        language: book.language,
        pageCount: "pageCount" in book ? book.pageCount : null,
        series: "series" in book ? book.series : null,
        seriesNumber: "seriesNumber" in book ? book.seriesNumber : null,
        duration: "duration" in book ? book.duration : null,
        narrator: "narrator" in book ? book.narrator : null,
        chapters: "chapters" in book ? book.chapters : null,
        coverPath: `data/covers/${book.id}.jpg`,
        coverColor: book.coverColor,
        readingProgress: book.progress,
        lastReadAt: book.progress > 0 ? createdAt : null,
        lastPosition: book.lastPosition,
        isRead: "isRead" in book ? book.isRead : false,
        rating: book.rating,
        createdAt,
        updatedAt: createdAt,
        importedAt: createdAt,
      })
      .run();

    db.insert(userBookState)
      .values({
        id: `state-${book.id}`,
        profileId: SHOWCASE_PROFILE_ID,
        bookId: book.id,
        readingProgress: book.progress,
        lastReadAt: book.progress > 0 ? createdAt : null,
        lastPosition: book.lastPosition,
        isRead: "isRead" in book ? book.isRead : false,
        rating: book.rating,
        updatedAt: createdAt,
      })
      .run();
  }

  const readerBook = db.select().from(books).where(eq(books.id, "showcase-gatsby")).get();
  if (!readerBook) throw new Error("Showcase reader book was not seeded");
  const [{ buildBundleFromEpub }, { CCD_VERSION }, { storeCcdBundle }] = await Promise.all([
    import("../../app/lib/content-ast/bundle.js"),
    import("../../app/lib/content-ast/types.js"),
    import("../../app/lib/storage/index.js"),
  ]);
  const readerBundle = await buildBundleFromEpub(
    resolve(booksDir, readerBook.fileName),
    readerBook.id,
    "epub",
  );
  const ccdPath = storeCcdBundle(readerBook.id, JSON.stringify(readerBundle));
  db.update(books)
    .set({ ccdPath, ccdVersion: CCD_VERSION, ccdError: null })
    .where(eq(books.id, readerBook.id))
    .run();

  const collectionsData = [
    {
      id: "collection-evenings",
      name: "Quiet evenings",
      description: "Books to settle into",
      color: "#2f6b55",
      icon: "moon",
    },
    {
      id: "collection-big-worlds",
      name: "Big worlds",
      description: "Long journeys and strange places",
      color: "#b47a21",
      icon: "sparkles",
    },
  ];
  db.insert(collections)
    .values(
      collectionsData.map((item, index) => ({
        ...item,
        profileId: SHOWCASE_PROFILE_ID,
        sortOrder: index,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .run();
  db.insert(booksCollections)
    .values([
      { bookId: "showcase-gatsby", collectionId: "collection-evenings", addedAt: now },
      { bookId: "showcase-dune", collectionId: "collection-big-worlds", addedAt: now },
      { bookId: "showcase-project-hail-mary", collectionId: "collection-big-worlds", addedAt: now },
      { bookId: "showcase-saga", collectionId: "collection-big-worlds", addedAt: now },
    ])
    .run();

  db.insert(tags)
    .values([
      {
        id: "tag-modern-classic",
        profileId: SHOWCASE_PROFILE_ID,
        name: "Modern classic",
        color: "#2f6b55",
        createdAt: now,
      },
      {
        id: "tag-space",
        profileId: SHOWCASE_PROFILE_ID,
        name: "Space",
        color: "#80631a",
        createdAt: now,
      },
    ])
    .run();
  db.insert(booksTags)
    .values([
      { bookId: "showcase-gatsby", tagId: "tag-modern-classic", addedAt: now },
      { bookId: "showcase-project-hail-mary", tagId: "tag-space", addedAt: now },
      { bookId: "showcase-dune", tagId: "tag-space", addedAt: now },
    ])
    .run();

  db.insert(readingSessions)
    .values([
      {
        id: "session-gatsby-today",
        profileId: SHOWCASE_PROFILE_ID,
        bookId: "showcase-gatsby",
        startedAt: new Date("2026-08-23T12:20:00.000Z"),
        endedAt: new Date("2026-08-23T12:52:00.000Z"),
        startPosition: "0.68",
        endPosition: "0.73",
        pagesRead: 9,
      },
      {
        id: "session-dune-yesterday",
        profileId: SHOWCASE_PROFILE_ID,
        bookId: "showcase-dune",
        startedAt: new Date("2026-08-22T23:10:00.000Z"),
        endedAt: new Date("2026-08-22T23:36:00.000Z"),
        startPosition: "0.41",
        endPosition: "0.45",
        pagesRead: 12,
      },
    ])
    .run();

  rawDb.pragma("wal_checkpoint(TRUNCATE)");
  writeFileSync(
    resolve(SHOWCASE_ROOT, "seed.json"),
    `${JSON.stringify({ profileId: SHOWCASE_PROFILE_ID, generatedAt: now.toISOString(), books: showcaseBooks.map(({ id, title }) => ({ id, title })) }, null, 2)}\n`,
  );
  console.log(`Seeded ${showcaseBooks.length} books in ${SHOWCASE_DATA_DIR}`);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await seedShowcase();
}
