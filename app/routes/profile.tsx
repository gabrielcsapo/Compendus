import { Suspense } from "react";
import { getCurrentProfile } from "../actions/profiles";
import ProfileClient from "./profile.client";

export default function ProfilePage() {
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <ProfileData />
    </Suspense>
  );
}

async function ProfileData() {
  const profile = await getCurrentProfile();
  return <ProfileClient initialProfile={profile} />;
}

function ProfileSkeleton() {
  return (
    <main className="container my-8 px-6 mx-auto">
      <div className="animate-pulse">
        <div className="h-8 bg-surface-elevated rounded w-32 mb-6" />
        <div className="flex items-center gap-6 mb-8">
          <div className="w-24 h-24 bg-surface-elevated rounded-full" />
          <div className="space-y-2">
            <div className="h-6 bg-surface-elevated rounded w-40" />
            <div className="h-4 bg-surface-elevated rounded w-24" />
          </div>
        </div>
      </div>
    </main>
  );
}
