# Compendus

A personal digital library for managing and reading your book collection. Supports PDF, EPUB, MOBI, CBR, and CBZ formats.

## Features

- **Multi-format Support** - Import and read PDF, EPUB, MOBI, CBR, and CBZ files
- **Automatic Metadata** - Fetches book metadata and covers from Google Books and Open Library
- **Custom Covers** - Upload your own cover images for any book
- **Reading Progress** - Tracks your reading progress across all books
- **Collections** - Organize books into custom collections
- **Tags** - Add tags to books for easy filtering and organization
- **Full-text Search** - Search across book titles, authors, descriptions, and content
- **Dark Mode** - Toggle between light and dark themes
- **Global Upload** - Drag and drop files from anywhere on the site
- **Responsive Design** - Works on desktop and mobile devices

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) (recommended) or npm

## Getting Started

1. **Clone the repository**

   ```bash
   git clone https://github.com/gabrielcsapo/compendus.git
   cd compendus
   ```

2. **Install dependencies**

   ```bash
   pnpm install
   ```

3. **Initialize the database**

   ```bash
   pnpm db:migrate
   ```

4. **Start the development server**

   ```bash
   pnpm dev
   ```

5. **Open in browser**
   ```
   http://localhost:5173
   ```

## Scripts

| Command            | Description                                |
| ------------------ | ------------------------------------------ |
| `pnpm dev`         | Start development server                   |
| `pnpm build`       | Build for production                       |
| `pnpm preview`     | Preview production build                   |
| `pnpm db:generate` | Generate database migrations               |
| `pnpm db:migrate`  | Run database migrations                    |
| `pnpm db:studio`   | Open Drizzle Studio to browse the database |
| `pnpm lint`        | Run linter                                 |

## Project Structure

```
compendus/
├── app/
│   ├── actions/        # Server actions (books, tags, collections)
│   ├── components/     # React components
│   ├── lib/
│   │   ├── db/         # Database schema and migrations
│   │   ├── processing/ # Book processing (covers, metadata)
│   │   ├── search/     # Full-text search indexing
│   │   └── api/        # Public API helpers
│   └── routes/         # Page routes
├── data/               # SQLite database and uploaded files
│   ├── books/          # Uploaded book files
│   ├── covers/         # Cover images
│   └── compendus.db    # SQLite database
├── public/             # Static assets
└── react-router-vite/  # React Router RSC configuration
```

## API

Compendus exposes a REST API for external integrations:

| Endpoint                | Method | Description         |
| ----------------------- | ------ | ------------------- |
| `/api/books`            | GET    | List all books      |
| `/api/books/:id`        | GET    | Get book by ID      |
| `/api/books/isbn/:isbn` | GET    | Lookup book by ISBN |
| `/api/search?q=query`   | GET    | Search books        |
| `/api/upload`           | POST   | Upload a book file  |
| `/api/books/:id/cover`  | POST   | Upload custom cover |

## Tech Stack

- **Framework**: [React Router](https://reactrouter.com/) with React Server Components
- **Build Tool**: [Vite](https://vitejs.dev/)
- **Database**: [SQLite](https://sqlite.org/) with [Drizzle ORM](https://orm.drizzle.team/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Book Parsing**: epub-parser, mobi-parser, pdf.js
- **Image Processing**: [Sharp](https://sharp.pixelplumbing.com/)

## Supported Formats

| Format | Reading | Cover Extraction |
| ------ | ------- | ---------------- |
| PDF    | Yes     | Yes (first page) |
| EPUB   | Yes     | Yes              |
| MOBI   | Yes     | Yes              |
| CBR    | Yes     | Yes              |
| CBZ    | Yes     | Yes              |

## Data Storage

All data is stored locally:

- **Database**: `data/compendus.db` (SQLite)
- **Books**: `data/books/`
- **Covers**: `data/covers/`

## License

MIT
