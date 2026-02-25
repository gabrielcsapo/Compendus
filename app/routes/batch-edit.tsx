import { getAllBooksWithTags, getDistinctSeries, getDistinctAuthors } from "../actions/batch";
import { getTags } from "../actions/tags";
import { BatchEditClient } from "../components/BatchEditClient";

export default async function BatchEdit() {
  const [{ books, bookTags }, allTags, seriesNames, authorNames] = await Promise.all([
    getAllBooksWithTags(),
    getTags(),
    getDistinctSeries(),
    getDistinctAuthors(),
  ]);

  return <BatchEditClient books={books} bookTags={bookTags} allTags={allTags} seriesNames={seriesNames} authorNames={authorNames} />;
}
