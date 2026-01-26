declare module "foliate-js/view.js" {
  interface Section {
    createDocument(): Promise<Document>;
  }

  interface TocItem {
    label: string;
    href: string;
    id?: string;
  }

  interface Book {
    toc?: TocItem[];
    sections?: Section[];
  }

  export function makeBook(file: File): Promise<Book>;
}
