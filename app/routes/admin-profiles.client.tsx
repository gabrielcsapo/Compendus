"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { buttonStyles, inputStyles, badgeStyles } from "../lib/styles";
import { ProfileAvatar } from "../components/ProfileAvatar";

interface Profile {
  id: string;
  name: string;
  avatar: string | null;
  avatarUrl?: string | null;
  hasPin: boolean;
  isAdmin: boolean;
  createdAt: string | null;
}

interface CurrentProfile {
  id: string;
  name: string;
  isAdmin: boolean;
}

export default function AdminProfilesClient({
  initialProfiles,
  initialCurrentProfile,
}: {
  initialProfiles?: Profile[];
  initialCurrentProfile?: CurrentProfile | null;
}) {
  const [profiles, setProfiles] = useState<Profile[]>(initialProfiles ?? []);
  const [currentProfile, setCurrentProfile] = useState<CurrentProfile | null>(
    initialCurrentProfile ?? null,
  );
  const [loading, setLoading] = useState(!initialProfiles);
  const [error, setError] = useState<string | null>(null);
  const hadInitialData = useRef(!!initialProfiles);

  // Create/Edit modal
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [modalName, setModalName] = useState("");
  const [modalAvatar, setModalAvatar] = useState("");
  const [modalPin, setModalPin] = useState("");
  const [modalIsAdmin, setModalIsAdmin] = useState(false);
  const [modalClearPin, setModalClearPin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Delete confirmation
  const [deletingProfile, setDeletingProfile] = useState<Profile | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [profilesRes, meRes] = await Promise.all([
        fetch("/api/profiles"),
        fetch("/api/profiles/me"),
      ]);
      const profilesData = await profilesRes.json();
      const meData = await meRes.json();

      if (profilesData.success) {
        setProfiles(profilesData.profiles);
      } else {
        setError("Failed to load profiles");
      }

      if (meData.success) {
        setCurrentProfile(meData.profile);
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
    fetchData();
  }, [fetchData]);

  const openCreate = () => {
    setEditingProfile(null);
    setModalName("");
    setModalAvatar("");
    setModalPin("");
    setModalIsAdmin(false);
    setModalClearPin(false);
    setModalError(null);
    setShowModal(true);
  };

  const openEdit = (profile: Profile) => {
    setEditingProfile(profile);
    setModalName(profile.name);
    setModalAvatar(profile.avatar || "");
    setModalPin("");
    setModalIsAdmin(profile.isAdmin);
    setModalClearPin(false);
    setModalError(null);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingProfile(null);
    setModalName("");
    setModalAvatar("");
    setModalPin("");
    setModalIsAdmin(false);
    setModalClearPin(false);
    setModalError(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalName.trim()) return;

    setSaving(true);
    setModalError(null);

    try {
      if (editingProfile) {
        // Update existing profile
        const body: Record<string, unknown> = {
          name: modalName.trim(),
          avatar: modalAvatar.trim() || null,
          isAdmin: modalIsAdmin,
        };
        if (modalPin) {
          body.pin = modalPin;
        } else if (modalClearPin) {
          body.pin = null;
        }

        const res = await fetch(`/api/profiles/${editingProfile.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!data.success) {
          setModalError(data.error || "Failed to update profile");
          return;
        }
      } else {
        // Create new profile
        const res = await fetch("/api/profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: modalName.trim(),
            avatar: modalAvatar.trim() || undefined,
            pin: modalPin || undefined,
          }),
        });
        const data = await res.json();
        if (!data.success) {
          setModalError(data.error || "Failed to create profile");
          return;
        }
      }

      closeModal();
      fetchData();
    } catch {
      setModalError("An error occurred");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingProfile) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/profiles/${deletingProfile.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        setDeletingProfile(null);
        fetchData();
      } else {
        setError(data.error || "Failed to delete profile");
        setDeletingProfile(null);
      }
    } catch {
      setError("Failed to delete profile");
      setDeletingProfile(null);
    } finally {
      setDeleting(false);
    }
  };

  const toggleAdmin = async (profile: Profile) => {
    try {
      const res = await fetch(`/api/profiles/${profile.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAdmin: !profile.isAdmin }),
      });
      const data = await res.json();
      if (data.success) {
        fetchData();
      }
    } catch {
      // Silently fail
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error && profiles.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-foreground-muted mb-4">{error}</p>
        <button onClick={fetchData} className={`${buttonStyles.base} ${buttonStyles.primary}`}>
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Profiles</h2>
          <p className="text-sm text-foreground-muted">
            {profiles.length} {profiles.length === 1 ? "profile" : "profiles"}
          </p>
        </div>
        <button onClick={openCreate} className={`${buttonStyles.base} ${buttonStyles.primary}`}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Profile
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-danger-light text-danger text-sm border border-danger/20">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline hover:no-underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Profile List */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        {profiles.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-surface-elevated flex items-center justify-center">
              <svg
                className="w-7 h-7 text-foreground-muted"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            </div>
            <p className="text-foreground-muted">No profiles yet</p>
            <p className="text-foreground-muted/60 text-sm mt-1">Create a profile to get started</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {profiles.map((profile) => {
              const isSelf = currentProfile?.id === profile.id;
              return (
                <div
                  key={profile.id}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-surface-elevated/50 transition-colors"
                >
                  {/* Avatar */}
                  <ProfileAvatar profile={profile} size="md" className="!w-12 !h-12 text-xl" />

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-foreground">{profile.name}</span>
                      {isSelf && (
                        <span className={`${badgeStyles.base} ${badgeStyles.primary}`}>You</span>
                      )}
                      {profile.isAdmin && (
                        <span className={`${badgeStyles.base} ${badgeStyles.warning}`}>Admin</span>
                      )}
                      {profile.hasPin && (
                        <span className={`${badgeStyles.base} ${badgeStyles.neutral}`}>
                          <svg
                            className="w-3 h-3 mr-1"
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
                          PIN
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-foreground-muted mt-0.5">
                      Created{" "}
                      {profile.createdAt
                        ? new Date(profile.createdAt).toLocaleDateString()
                        : "Unknown"}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Admin toggle */}
                    <button
                      onClick={() => toggleAdmin(profile)}
                      disabled={isSelf}
                      title={
                        isSelf
                          ? "Cannot change your own admin status"
                          : profile.isAdmin
                            ? "Remove admin"
                            : "Make admin"
                      }
                      className={`p-2 rounded-lg transition-colors ${
                        isSelf
                          ? "opacity-30 cursor-not-allowed text-foreground-muted"
                          : profile.isAdmin
                            ? "text-warning hover:bg-warning-light"
                            : "text-foreground-muted hover:bg-surface-elevated hover:text-foreground"
                      }`}
                    >
                      <svg
                        className="w-4 h-4"
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
                    </button>

                    {/* Edit */}
                    <button
                      onClick={() => openEdit(profile)}
                      className="p-2 rounded-lg text-foreground-muted hover:bg-surface-elevated hover:text-foreground transition-colors"
                      title="Edit profile"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                        />
                      </svg>
                    </button>

                    {/* Delete */}
                    <button
                      onClick={() => setDeletingProfile(profile)}
                      disabled={isSelf}
                      title={isSelf ? "Cannot delete your own profile" : "Delete profile"}
                      className={`p-2 rounded-lg transition-colors ${
                        isSelf
                          ? "opacity-30 cursor-not-allowed text-foreground-muted"
                          : "text-foreground-muted hover:bg-danger-light hover:text-danger"
                      }`}
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-surface border border-border rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <h2 className="text-lg font-semibold text-foreground mb-1">
              {editingProfile ? "Edit Profile" : "Create Profile"}
            </h2>
            <p className="text-sm text-foreground-muted mb-6">
              {editingProfile
                ? `Update settings for ${editingProfile.name}`
                : "Add a new reader profile"}
            </p>

            <form onSubmit={handleSave}>
              {/* Avatar preview */}
              <div className="flex justify-center mb-6">
                <div className="w-20 h-20 rounded-full bg-surface-elevated border-2 border-border flex items-center justify-center text-3xl">
                  {modalAvatar ? (
                    <span>{modalAvatar}</span>
                  ) : modalName ? (
                    <span className="text-foreground-muted">
                      {modalName.charAt(0).toUpperCase()}
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
                  value={modalName}
                  onChange={(e) => setModalName(e.target.value)}
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
                  value={modalAvatar}
                  onChange={(e) => {
                    const val = e.target.value;
                    const segments = [...new Intl.Segmenter().segment(val)].map((s) => s.segment);
                    setModalAvatar(segments.length > 0 ? segments[segments.length - 1] : "");
                  }}
                  placeholder="e.g. a book or face emoji"
                  className={`${inputStyles} text-center text-2xl`}
                />
              </div>

              {/* PIN */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  {editingProfile ? "New PIN" : "PIN"}
                  <span className="text-foreground-muted font-normal ml-1">(optional)</span>
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={modalPin}
                  onChange={(e) => setModalPin(e.target.value.replace(/\D/g, ""))}
                  placeholder={editingProfile ? "Leave empty to keep current" : "4-6 digit PIN"}
                  className={inputStyles}
                />
                {editingProfile && editingProfile.hasPin && (
                  <label className="flex items-center gap-2 mt-2 text-sm text-foreground-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={modalClearPin}
                      onChange={(e) => setModalClearPin(e.target.checked)}
                      className="rounded border-border text-primary focus:ring-primary"
                    />
                    Remove existing PIN
                  </label>
                )}
              </div>

              {/* Admin toggle (only when editing, not for self) */}
              {editingProfile && currentProfile?.id !== editingProfile.id && (
                <div className="mb-6">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <div
                      role="switch"
                      aria-checked={modalIsAdmin}
                      tabIndex={0}
                      onClick={() => setModalIsAdmin(!modalIsAdmin)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setModalIsAdmin(!modalIsAdmin);
                        }
                      }}
                      className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${
                        modalIsAdmin ? "bg-primary" : "bg-surface-elevated border border-border"
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                          modalIsAdmin ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </div>
                    <div>
                      <span className="text-sm font-medium text-foreground">Admin</span>
                      <p className="text-xs text-foreground-muted">
                        Admins can manage profiles, upload books, and access admin settings
                      </p>
                    </div>
                  </label>
                </div>
              )}

              {/* Admin toggle for create */}
              {!editingProfile && (
                <div className="mb-6">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <div
                      role="switch"
                      aria-checked={modalIsAdmin}
                      tabIndex={0}
                      onClick={() => setModalIsAdmin(!modalIsAdmin)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setModalIsAdmin(!modalIsAdmin);
                        }
                      }}
                      className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${
                        modalIsAdmin ? "bg-primary" : "bg-surface-elevated border border-border"
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                          modalIsAdmin ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </div>
                    <div>
                      <span className="text-sm font-medium text-foreground">Admin</span>
                      <p className="text-xs text-foreground-muted">
                        Admins can manage profiles, upload books, and access admin settings
                      </p>
                    </div>
                  </label>
                </div>
              )}

              {modalError && <p className="text-sm text-danger mb-4">{modalError}</p>}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className={`${buttonStyles.base} ${buttonStyles.ghost} flex-1`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!modalName.trim() || saving}
                  className={`${buttonStyles.base} ${buttonStyles.primary} flex-1`}
                >
                  {saving ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : editingProfile ? (
                    "Save Changes"
                  ) : (
                    "Create"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-surface border border-border rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-semibold text-foreground mb-2">Delete Profile</h2>
            <p className="text-sm text-foreground-muted mb-6">
              Are you sure you want to delete{" "}
              <strong className="text-foreground">{deletingProfile.name}</strong>? This will remove
              all their reading progress, highlights, and settings. This action cannot be undone.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setDeletingProfile(null)}
                className={`${buttonStyles.base} ${buttonStyles.ghost} flex-1`}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className={`${buttonStyles.base} ${buttonStyles.danger} flex-1`}
              >
                {deleting ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  "Delete"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
