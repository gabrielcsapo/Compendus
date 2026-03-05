import { Suspense } from "react";
import { getProfiles } from "../actions/profiles";
import ProfilePickerClient from "./profiles.client";

export default function ProfilesPage() {
  return (
    <Suspense fallback={<ProfilePickerSkeleton />}>
      <ProfilesData />
    </Suspense>
  );
}

async function ProfilesData() {
  const profiles = await getProfiles();
  return <ProfilePickerClient initialProfiles={profiles} />;
}

function ProfilePickerSkeleton() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-center">
        <div className="h-8 bg-surface-elevated rounded w-48 mx-auto mb-8" />
        <div className="flex gap-6 justify-center">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="w-32 h-40 bg-surface-elevated rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
