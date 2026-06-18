import { JourneyClient } from "../components/JourneyClient";

/** One journey: the path of passages through a single theme. */
export default async function JourneyPage({ params }: { params?: Record<string, string> }) {
  const topicId = params?.topicId as string;
  return <JourneyClient topicId={topicId} />;
}
