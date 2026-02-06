import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),

  route("search", "routes/search.tsx"),

  route("book/:id", "routes/book.$id.tsx"),
  route("book/:id/read", "routes/book.$id.read.tsx"),

  route("author/:name", "routes/author.$name.tsx"),

  route("collections", "routes/collections.tsx"),
  route("collection/:id", "routes/collection.$id.tsx"),

  route("tags", "routes/tags.tsx"),
  route("unmatched", "routes/unmatched.tsx"),

  route("discover", "routes/discover.tsx", [
    index("routes/discover._index.tsx"),
    route("wishlist", "routes/discover.wishlist.tsx"),
    route("series", "routes/discover.series.tsx"),
  ]),

  route("about", "routes/about.tsx"),
  route("docs", "routes/docs.tsx"),
] satisfies RouteConfig;
