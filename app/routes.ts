import type { RouteConfig } from "react-flight-router/router";

export const routes: RouteConfig[] = [
  {
    id: "root",
    path: "",
    component: () => import("./root.js"),
    error: () => import("./routes/error.js"),
    notFound: () => import("./routes/not-found.js"),
    children: [
      { id: "dashboard", index: true, component: () => import("./routes/dashboard.js") },
      { id: "library", path: "library", component: () => import("./routes/library.js") },
      { id: "search", path: "search", component: () => import("./routes/search.js") },
      { id: "book-detail", path: "book/:id", component: () => import("./routes/book-detail.js") },
      { id: "book-read", path: "book/:id/read", component: () => import("./routes/book-read.js") },
      { id: "book-edit", path: "book/:id/edit", component: () => import("./routes/book-edit.js") },
      { id: "highlights", path: "highlights", component: () => import("./routes/highlights.js") },
      { id: "author", path: "author/:name", component: () => import("./routes/author.js") },
      {
        id: "collections",
        path: "collections",
        component: () => import("./routes/collections.js"),
      },
      {
        id: "collection-detail",
        path: "collection/:id",
        component: () => import("./routes/collection-detail.js"),
      },
      { id: "tags", path: "tags", component: () => import("./routes/tags.js") },
      {
        id: "admin",
        path: "admin",
        component: () => import("./routes/admin.js"),
        children: [
          { id: "admin-data", index: true, component: () => import("./routes/admin-data.js") },
          {
            id: "admin-batch-edit",
            path: "batch-edit",
            component: () => import("./routes/batch-edit.js"),
          },
          {
            id: "admin-unmatched",
            path: "unmatched",
            component: () => import("./routes/unmatched.js"),
          },
          {
            id: "admin-profiles",
            path: "profiles",
            component: () => import("./routes/admin-profiles.js"),
          },
        ],
      },
      {
        id: "discover",
        path: "discover",
        component: () => import("./routes/discover.js"),
        children: [
          {
            id: "discover-index",
            index: true,
            component: () => import("./routes/discover-index.js"),
          },
        ],
      },
      { id: "profile", path: "profile", component: () => import("./routes/profile.js") },
      { id: "profiles", path: "profiles", component: () => import("./routes/profiles.js") },
      { id: "about", path: "about", component: () => import("./routes/about.js") },
      { id: "docs", path: "docs", component: () => import("./routes/docs.js") },
    ],
  },
];
