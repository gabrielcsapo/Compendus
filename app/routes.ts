import type { unstable_RSCRouteConfigEntry } from "react-router";

export const routes: unstable_RSCRouteConfigEntry[] = [
  {
    id: "root",
    path: "",
    lazy: () => import("./root"),
    children: [
      {
        id: "home",
        index: true,
        lazy: () => import("./routes/home"),
      },
      {
        id: "search",
        path: "search",
        lazy: () => import("./routes/search"),
      },
      {
        id: "book",
        path: "book/:id",
        lazy: () => import("./routes/book.$id"),
      },
      {
        id: "book-read",
        path: "book/:id/read",
        lazy: () => import("./routes/book.$id.read"),
      },
      {
        id: "collections",
        path: "collections",
        lazy: () => import("./routes/collections"),
      },
      {
        id: "collection",
        path: "collection/:id",
        lazy: () => import("./routes/collection.$id"),
      },
      {
        id: "tags",
        path: "tags",
        lazy: () => import("./routes/tags"),
      },
      {
        id: "unmatched",
        path: "unmatched",
        lazy: () => import("./routes/unmatched"),
      },
      {
        id: "about",
        path: "about",
        lazy: () => import("./routes/about"),
      },
    ],
  },
];
