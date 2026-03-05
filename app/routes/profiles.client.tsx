"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "react-flight-router/client";
import { buttonStyles, inputStyles } from "../lib/styles";

interface Profile {
  id: string;
  name: string;
  avatar: string | null;
  hasPin: boolean;
  isAdmin: boolean;
  createdAt: string | null;
}

export default function ProfilePickerClient({ initialProfiles }: { initialProfiles?: Profile[] }) {
  const [profiles, setProfiles] = useState<Profile[]>(initialProfiles ?? []);
  const [loading, setLoading] = useState(!initialProfiles);
  const [error, setError] = useState<string | null>(null);
  const hadInitialData = useRef(!!initialProfiles);

  // PIN entry modal
  const [pinProfile, setPinProfile] = useState<Profile | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);

  // Create profile modal
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createAvatar, setCreateAvatar] = useState("");
  const [createPin, setCreatePin] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const router = useRouter();

  const fetchProfiles = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/profiles");
      const data = await res.json();
      if (data.success) {
        setProfiles(data.profiles);
      } else {
        setError("Failed to load profiles");
      }
    } catch {
      setError("Failed to load profiles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hadInitialData.current) {
      hadInitialData.current = false;
      return;
    }
    fetchProfiles();
  }, [fetchProfiles]);

  const selectProfile = async (profile: Profile, enteredPin?: string) => {
    setSelecting(true);
    setPinError(null);
    try {
      const res = await fetch(`/api/profiles/${profile.id}/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: enteredPin }),
      });
      const data = await res.json();
      if (data.success) {
        setPinProfile(null);
        setPin("");
        router.navigate("/");
      } else {
        if (enteredPin !== undefined) {
          setPinError("Incorrect PIN");
          setPin("");
        } else {
          setError("Failed to select profile");
        }
      }
    } catch {
      setError("Failed to select profile");
    } finally {
      setSelecting(false);
    }
  };

  const handleProfileClick = (profile: Profile) => {
    if (profile.hasPin) {
      setPinProfile(profile);
      setPin("");
      setPinError(null);
    } else {
      selectProfile(profile);
    }
  };

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pinProfile && pin.length > 0) {
      selectProfile(pinProfile, pin);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim()) return;

    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createName.trim(),
          avatar: createAvatar.trim() || undefined,
          pin: createPin || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowCreate(false);
        setCreateName("");
        setCreateAvatar("");
        setCreatePin("");
        fetchProfiles();
      } else {
        setCreateError(data.error || "Failed to create profile");
      }
    } catch {
      setCreateError("Failed to create profile");
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-[80vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  if (error && profiles.length === 0) {
    return (
      <main className="min-h-[80vh] flex items-center justify-center">
        <div className="text-center">
          <p className="text-foreground-muted mb-4">{error}</p>
          <button
            onClick={fetchProfiles}
            className={`${buttonStyles.base} ${buttonStyles.primary}`}
          >
            Try Again
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[80vh] flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-3xl">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-foreground mb-2">Who's reading?</h1>
          <p className="text-foreground-muted">Select your profile to continue</p>
        </div>

        {/* Profile Grid */}
        <div className="flex flex-wrap justify-center gap-8">
          {profiles.map((profile) => (
            <button
              key={profile.id}
              onClick={() => handleProfileClick(profile)}
              disabled={selecting}
              className="group flex flex-col items-center gap-3 focus:outline-none disabled:opacity-50"
            >
              {/* Avatar */}
              <div className="relative w-28 h-28 rounded-full bg-surface-elevated border-2 border-border group-hover:border-primary group-focus-visible:border-primary transition-all duration-200 flex items-center justify-center text-4xl group-hover:scale-105 group-hover:shadow-lg">
                {profile.avatar ? (
                  <span>{profile.avatar}</span>
                ) : (
                  <span className="text-foreground-muted">
                    {profile.name.charAt(0).toUpperCase()}
                  </span>
                )}
                {/* Lock icon for PIN-protected profiles */}
                {profile.hasPin && (
                  <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-surface border-2 border-border flex items-center justify-center">
                    <svg
                      className="w-3.5 h-3.5 text-foreground-muted"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                      />
                    </svg>
                  </div>
                )}
                {/* Admin badge */}
                {profile.isAdmin && (
                  <div className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-primary flex items-center justify-center">
                    <svg
                      className="w-3.5 h-3.5 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                      />
                    </svg>
                  </div>
                )}
              </div>
              {/* Name */}
              <span className="text-sm font-medium text-foreground-muted group-hover:text-foreground transition-colors">
                {profile.name}
              </span>
            </button>
          ))}

          {/* Add Profile Card */}
          <button
            onClick={() => setShowCreate(true)}
            className="group flex flex-col items-center gap-3 focus:outline-none"
          >
            <div className="w-28 h-28 rounded-full border-2 border-dashed border-border group-hover:border-primary group-focus-visible:border-primary transition-all duration-200 flex items-center justify-center group-hover:scale-105">
              <svg
                className="w-10 h-10 text-foreground-muted group-hover:text-primary transition-colors"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 4v16m8-8H4"
                />
              </svg>
            </div>
            <span className="text-sm font-medium text-foreground-muted group-hover:text-foreground transition-colors">
              Add Profile
            </span>
          </button>
        </div>
      </div>

      {/* PIN Entry Modal */}
      {pinProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-surface border border-border rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <div className="text-center mb-6">
              <div className="w-20 h-20 rounded-full bg-surface-elevated border-2 border-border mx-auto mb-3 flex items-center justify-center text-3xl">
                {pinProfile.avatar ? (
                  <span>{pinProfile.avatar}</span>
                ) : (
                  <span className="text-foreground-muted">
                    {pinProfile.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <h2 className="text-lg font-semibold text-foreground">{pinProfile.name}</h2>
              <p className="text-sm text-foreground-muted mt-1">Enter your PIN to continue</p>
            </div>

            <form onSubmit={handlePinSubmit}>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value.replace(/\D/g, ""));
                  setPinError(null);
                }}
                placeholder="Enter PIN"
                autoFocus
                className={`${inputStyles} text-center text-2xl tracking-[0.5em] mb-3`}
              />

              {pinError && <p className="text-sm text-danger text-center mb-3">{pinError}</p>}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setPinProfile(null);
                    setPin("");
                    setPinError(null);
                  }}
                  className={`${buttonStyles.base} ${buttonStyles.ghost} flex-1`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pin.length === 0 || selecting}
                  className={`${buttonStyles.base} ${buttonStyles.primary} flex-1`}
                >
                  {selecting ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    "Continue"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Profile Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-surface border border-border rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-semibold text-foreground mb-1">Create Profile</h2>
            <p className="text-sm text-foreground-muted mb-6">Add a new reader profile</p>

            <form onSubmit={handleCreate}>
              {/* Avatar preview */}
              <div className="flex justify-center mb-6">
                <div className="w-20 h-20 rounded-full bg-surface-elevated border-2 border-border flex items-center justify-center text-3xl">
                  {createAvatar ? (
                    <span>{createAvatar}</span>
                  ) : createName ? (
                    <span className="text-foreground-muted">
                      {createName.charAt(0).toUpperCase()}
                    </span>
                  ) : (
                    <svg
                      className="w-8 h-8 text-foreground-muted"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    </svg>
                  )}
                </div>
              </div>

              {/* Name */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-foreground mb-1.5">Name</label>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="Profile name"
                  required
                  autoFocus
                  className={inputStyles}
                />
              </div>

              {/* Avatar (Emoji) */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Avatar Emoji
                  <span className="text-foreground-muted font-normal ml-1">(optional)</span>
                </label>
                <input
                  type="text"
                  value={createAvatar}
                  onChange={(e) => {
                    // Take only the last character/emoji entered
                    const val = e.target.value;
                    const segments = [...new Intl.Segmenter().segment(val)].map((s) => s.segment);
                    setCreateAvatar(segments.length > 0 ? segments[segments.length - 1] : "");
                  }}
                  placeholder="e.g. a book or face emoji"
                  className={`${inputStyles} text-center text-2xl`}
                />
              </div>

              {/* PIN */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  PIN
                  <span className="text-foreground-muted font-normal ml-1">(optional)</span>
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={createPin}
                  onChange={(e) => setCreatePin(e.target.value.replace(/\D/g, ""))}
                  placeholder="4-6 digit PIN"
                  className={inputStyles}
                />
                <p className="text-xs text-foreground-muted mt-1">
                  Set a PIN to protect this profile from unauthorized access
                </p>
              </div>

              {createError && <p className="text-sm text-danger mb-4">{createError}</p>}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreate(false);
                    setCreateName("");
                    setCreateAvatar("");
                    setCreatePin("");
                    setCreateError(null);
                  }}
                  className={`${buttonStyles.base} ${buttonStyles.ghost} flex-1`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!createName.trim() || creating}
                  className={`${buttonStyles.base} ${buttonStyles.primary} flex-1`}
                >
                  {creating ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    "Create"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
