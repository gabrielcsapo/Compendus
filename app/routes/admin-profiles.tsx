import { Suspense } from "react";
import { getProfiles, getCurrentProfile } from "../actions/profiles";
import AdminProfilesClient from "./admin-profiles.client";

export default function AdminProfilesPage() {
  return (
    <Suspense fallback={<ProfilesSkeleton />}>
      <AdminProfilesData />
    </Suspense>
  );
}

async function AdminProfilesData() {
  const [profiles, currentProfile] = await Promise.all([getProfiles(), getCurrentProfile()]);
  return (
    <AdminProfilesClient
      initialProfiles={profiles}
      initialCurrentProfile={
        currentProfile
          ? { id: currentProfile.id, name: currentProfile.name, isAdmin: currentProfile.isAdmin }
          : null
      }
    />
  );
}

function ProfilesSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 bg-surface-elevated rounded w-48 mb-6" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-20 bg-surface-elevated rounded-xl" />
      ))}
    </div>
  );
}
