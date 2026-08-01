import { JourneyClient } from "../components/JourneyClient";

/** One Pod session. `/journey/:topicId` remains a compatibility alias. */
export default function PodPage({ params }: { params?: Record<string, string> }) {
  const podId = (params?.podId ?? params?.topicId) as string;
  return <JourneyClient podId={podId} />;
}
