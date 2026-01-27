import { type LoaderFunctionArgs } from "react-router";
import { getBook } from "../actions/books";
import { ReaderContainer } from "../components/readers/ReaderContainer";

type LoaderData = Awaited<ReturnType<typeof loader>>;

export async function loader({ params }: LoaderFunctionArgs) {
  const id = params.id as string;
  const book = await getBook(id);
  if (!book) {
    throw new Response("Book not found", { status: 404 });
  }
  return { book };
}

function BookReader({ loaderData }: { loaderData: LoaderData }) {
  const { book } = loaderData;
  return <ReaderContainer book={book} />;
}

// Export both Component and default for React Router compatibility
export { BookReader as Component };
export default BookReader;
