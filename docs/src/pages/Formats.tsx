import { supportedFormats } from "@app/lib/api/spec";

const formatDetails = [
  {
    category: "Ebooks",
    formats: [
      {
        ext: "EPUB",
        description:
          "Standard ebook format. Converted on the server to a Compendus Content Document (CCD) that both the web and iOS readers render natively, with highlights and bookmarks.",
        conversion: "Converted to CCD on the server",
      },
      {
        ext: "PDF",
        description:
          "Portable Document Format. Rendered natively (page images with zoom); also converted to CCD so it can be read reflowably.",
        conversion: "Converted to CCD on the server",
      },
      {
        ext: "MOBI",
        description:
          "Amazon Kindle format. Converted to CCD on the server for native reading — no on-device EPUB conversion.",
        conversion: "Converted to CCD on the server",
      },
      {
        ext: "AZW3",
        description:
          "Amazon KF8 format. Converted to CCD on the server for native reading — no on-device EPUB conversion.",
        conversion: "Converted to CCD on the server",
      },
    ],
  },
  {
    category: "Comics",
    formats: [
      {
        ext: "CBZ",
        description:
          "Comic Book ZIP archive. Pages extracted and served as images with page navigation.",
        conversion: "Native format",
      },
      {
        ext: "CBR",
        description:
          "Comic Book RAR archive. Auto-converted to CBZ on first access for extraction.",
        conversion: "Auto-converts to CBZ",
      },
    ],
  },
  {
    category: "Audiobooks",
    formats: [
      {
        ext: "M4B",
        description:
          "Apple audiobook format with chapter metadata. Supports playback, transcription, and text-to-speech sync.",
        conversion: null,
      },
      {
        ext: "M4A",
        description:
          "AAC audio format. Can be merged with other audio files into a single audiobook.",
        conversion: null,
      },
      {
        ext: "MP3",
        description:
          "MP3 audio format. Can be merged with other audio files into a single audiobook.",
        conversion: null,
      },
    ],
  },
];

export default function Formats() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">Supported Formats</h1>
        <p className="text-foreground-muted">
          Compendus supports a wide range of book, comic, and audiobook formats with automatic
          conversion where needed.
        </p>
      </div>

      {/* MIME Types Grid */}
      <section>
        <h2 className="text-xl font-semibold text-foreground mb-3">MIME Types</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Object.entries(supportedFormats.books.mimeTypes).map(([format, mimeType]) => (
            <div key={format} className="p-4 bg-surface-elevated rounded-lg border border-border">
              <h3 className="font-semibold text-foreground uppercase text-sm">.{format}</h3>
              <p className="text-xs text-foreground-muted font-mono mt-1">{mimeType}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Detailed Format Info */}
      {formatDetails.map((category) => (
        <section key={category.category}>
          <h2 className="text-xl font-semibold text-foreground mb-4">{category.category}</h2>
          <div className="space-y-3">
            {category.formats.map((format) => (
              <div key={format.ext} className="border border-border rounded-lg p-4">
                <div className="flex items-center gap-3 mb-2">
                  <span className="px-2.5 py-1 bg-primary-light text-primary text-xs font-mono font-semibold rounded">
                    .{format.ext.toLowerCase()}
                  </span>
                  <h3 className="font-medium text-foreground">{format.ext}</h3>
                </div>
                <p className="text-sm text-foreground-muted">{format.description}</p>
                {format.conversion && (
                  <p className="text-xs text-foreground-muted/70 mt-2">
                    Conversion: {format.conversion}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      {/* Cover Images */}
      <section>
        <h2 className="text-xl font-semibold text-foreground mb-3">Cover Images</h2>
        <p className="text-foreground mb-3">
          Custom cover images can be uploaded in the following formats:
        </p>
        <div className="flex flex-wrap gap-2">
          {supportedFormats.covers.extensions.map((ext) => (
            <span
              key={ext}
              className="px-3 py-1.5 bg-surface-elevated border border-border rounded-lg text-sm font-mono text-foreground"
            >
              {ext}
            </span>
          ))}
        </div>
        <p className="text-sm text-foreground-muted mt-3">
          Covers are automatically extracted from EPUB and PDF files during upload. A dominant color
          is extracted from each cover for UI theming.
        </p>
      </section>

      {/* Conversion Matrix */}
      <section>
        <h2 className="text-xl font-semibold text-foreground mb-3">Conversion Support</h2>
        <p className="text-sm text-foreground-muted mb-3">
          Reflowable books are converted on the server to a Compendus Content Document (CCD) — a
          canonical block/inline JSON document that the web and iOS readers render natively. The
          clients no longer parse EPUB/MOBI on-device. Comics convert RAR archives to ZIP for
          extraction.
        </p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-foreground-muted border-b border-border">
                <th className="pr-6 py-2">Source</th>
                <th className="pr-6 py-2">Target</th>
                <th className="py-2">Method</th>
              </tr>
            </thead>
            <tbody className="text-foreground">
              {[
                ["EPUB", "CCD", "Server-side CCD generation (background job)"],
                ["PDF", "CCD", "Server-side CCD generation (background job)"],
                ["MOBI", "CCD", "Server-side CCD generation (background job)"],
                ["AZW3", "CCD", "Server-side CCD generation (background job)"],
                ["CBR", "CBZ", "Automatic on first access"],
              ].map(([source, target, method]) => (
                <tr key={source} className="border-b border-border/50">
                  <td className="pr-6 py-2">
                    <code className="bg-surface-elevated px-1.5 py-0.5 rounded border border-border">
                      {source}
                    </code>
                  </td>
                  <td className="pr-6 py-2">
                    <code className="bg-surface-elevated px-1.5 py-0.5 rounded border border-border">
                      {target}
                    </code>
                  </td>
                  <td className="py-2 text-foreground-muted">{method}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
