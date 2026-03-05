"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-flight-router/client";
import { ProfileAvatar } from "../components/ProfileAvatar";
import { buttonStyles, badgeStyles } from "../lib/styles";
import { isAvatarImage } from "../lib/avatar";

interface Profile {
  id: string;
  name: string;
  avatar: string | null;
  avatarUrl: string | null;
  hasPin: boolean;
  isAdmin: boolean;
  createdAt: string | null;
}

const EMOJI_SUGGESTIONS = [
  "\u{1F60A}",
  "\u{1F4DA}",
  "\u{1F98A}",
  "\u{1F31F}",
  "\u{1F3A8}",
  "\u{1F3B5}",
  "\u{1F308}",
  "\u{1F680}",
  "\u{1F431}",
  "\u{1F33A}",
  "\u{1F989}",
  "\u{1F340}",
  "\u{1F9D1}\u{200D}\u{1F4BB}",
  "\u{1F436}",
  "\u{1F33B}",
  "\u{26A1}",
];

export default function ProfileClient({ initialProfile }: { initialProfile?: Profile | null }) {
  const [profile, setProfile] = useState<Profile | null>(initialProfile ?? null);
  const [loading, setLoading] = useState(initialProfile === undefined);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinSaving, setPinSaving] = useState(false);
  const [showNameModal, setShowNameModal] = useState(false);
  const [editName, setEditName] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hadInitialData = useRef(initialProfile !== undefined);

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch("/api/profiles/me");
      const data = await res.json();
      if (data.success && data.profile) {
        setProfile(data.profile);
      } else {
        setError("No profile selected");
      }
    } catch {
      setError("Failed to load profile");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hadInitialData.current) {
      hadInitialData.current = false;
      return;
    }
    fetchProfile();
  }, [fetchProfile]);

  const handleImageUpload = async (file: File) => {
    if (!profile) return;

    const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!validTypes.includes(file.type)) {
      setError("Please select a JPEG, PNG, WebP, or GIF image");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError("Image must be under 10MB");
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("avatar", file);
      const res = await fetch(`/api/profiles/${profile.id}/avatar`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.success && data.profile) {
        setProfile(data.profile);
      } else {
        setError(data.error || "Failed to upload avatar");
      }
    } catch {
      setError("Failed to upload avatar");
    } finally {
      setUploading(false);
    }
  };

  const handleEmojiSelect = async (emoji: string) => {
    if (!profile) return;
    setShowEmojiPicker(false);
    setError(null);
    try {
      const res = await fetch(`/api/profiles/${profile.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar: emoji }),
      });
      const data = await res.json();
      if (data.success && data.profile) {
        setProfile(data.profile);
      }
    } catch {
      setError("Failed to update avatar");
    }
  };

  const handleRemoveAvatar = async () => {
    if (!profile) return;
    setError(null);
    try {
      if (isAvatarImage(profile.avatar)) {
        const res = await fetch(`/api/profiles/${profile.id}/avatar`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (data.success && data.profile) {
          setProfile(data.profile);
        }
      } else {
        const res = await fetch(`/api/profiles/${profile.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ avatar: null }),
        });
        const data = await res.json();
        if (data.success && data.profile) {
          setProfile(data.profile);
        }
      }
    } catch {
      setError("Failed to remove avatar");
    }
  };

  const openNameModal = () => {
    setEditName(profile?.name ?? "");
    setShowNameModal(true);
  };

  const handleNameSave = async () => {
    if (!profile || !editName.trim() || editName.trim() === profile.name) return;
    setNameSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/profiles/${profile.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim() }),
      });
      const data = await res.json();
      if (data.success && data.profile) {
        setProfile(data.profile);
      } else {
        setError(data.error || "Failed to update name");
      }
    } catch {
      setError("Failed to update name");
    } finally {
      setNameSaving(false);
      setShowNameModal(false);
    }
  };

  const openPinModal = () => {
    setPin("");
    setConfirmPin("");
    setShowPinModal(true);
  };

  const handlePinSave = async () => {
    if (!profile || pin.length !== 4 || pin !== confirmPin) return;
    setPinSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/profiles/${profile.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (data.success && data.profile) {
        setProfile(data.profile);
      } else {
        setError(data.error || "Failed to update PIN");
      }
    } catch {
      setError("Failed to update PIN");
    } finally {
      setPinSaving(false);
      setShowPinModal(false);
    }
  };

  const handlePinRemove = async () => {
    if (!profile) return;
    setPinSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/profiles/${profile.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: null }),
      });
      const data = await res.json();
      if (data.success && data.profile) {
        setProfile(data.profile);
      } else {
        setError(data.error || "Failed to remove PIN");
      }
    } catch {
      setError("Failed to remove PIN");
    } finally {
      setPinSaving(false);
      setShowPinModal(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-[80vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="min-h-[80vh] flex items-center justify-center">
        <div className="text-center">
          <p className="text-foreground-muted mb-4">{error || "No profile found"}</p>
          <Link to="/profiles" className={`${buttonStyles.base} ${buttonStyles.primary}`}>
            Select Profile
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="container mx-auto px-6 py-12 max-w-xl">
      <h1 className="text-2xl font-bold text-foreground mb-8">Profile</h1>

      {/* Avatar Section */}
      <div className="flex flex-col items-center mb-8">
        <div className="relative mb-4">
          <ProfileAvatar
            profile={profile}
            size="xl"
            key={profile.avatarUrl || profile.avatar || "none"}
          />
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-full">
              <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>

        <div className="flex gap-2 flex-wrap justify-center">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className={`${buttonStyles.base} ${buttonStyles.ghost} text-sm !px-3 !py-1.5`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            Upload Photo
          </button>
          <button
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            className={`${buttonStyles.base} ${buttonStyles.ghost} text-sm !px-3 !py-1.5`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            Choose Emoji
          </button>
          {profile.avatar && (
            <button
              onClick={handleRemoveAvatar}
              className={`${buttonStyles.base} ${buttonStyles.ghost} text-sm !px-3 !py-1.5 !text-danger`}
            >
              Remove
            </button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImageUpload(file);
            e.target.value = "";
          }}
        />

        {/* Emoji Picker */}
        {showEmojiPicker && (
          <div className="mt-4 p-4 bg-surface border border-border rounded-xl shadow-lg">
            <div className="grid grid-cols-8 gap-2">
              {EMOJI_SUGGESTIONS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleEmojiSelect(emoji)}
                  className="w-10 h-10 rounded-lg hover:bg-surface-elevated transition-colors flex items-center justify-center text-xl"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-6 p-3 bg-danger-light border border-danger/20 rounded-lg text-sm text-danger text-center">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Profile Info */}
      <div className="bg-surface border border-border rounded-xl divide-y divide-border">
        <button
          onClick={openNameModal}
          className="w-full px-5 py-4 flex items-center justify-between hover:bg-surface-elevated transition-colors text-left"
        >
          <span className="text-sm text-foreground-muted">Name</span>
          <span className="text-sm font-medium text-foreground flex items-center gap-1.5">
            {profile.name}
            <svg
              className="w-4 h-4 text-foreground-muted"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </span>
        </button>

        <div className="px-5 py-4 flex items-center justify-between">
          <span className="text-sm text-foreground-muted">Role</span>
          <span
            className={
              profile.isAdmin
                ? `${badgeStyles.base} ${badgeStyles.warning}`
                : "text-sm text-foreground"
            }
          >
            {profile.isAdmin ? "Admin" : "Member"}
          </span>
        </div>

        <button
          onClick={openPinModal}
          className="w-full px-5 py-4 flex items-center justify-between hover:bg-surface-elevated transition-colors text-left"
        >
          <span className="text-sm text-foreground-muted">PIN Protection</span>
          <span className="text-sm text-foreground flex items-center gap-1.5">
            {profile.hasPin ? "Enabled" : "Not set"}
            <svg
              className="w-4 h-4 text-foreground-muted"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </span>
        </button>

        {profile.createdAt && (
          <div className="px-5 py-4 flex items-center justify-between">
            <span className="text-sm text-foreground-muted">Member since</span>
            <span className="text-sm text-foreground">
              {new Date(profile.createdAt).toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="mt-6 flex flex-col gap-3">
        <Link to="/profiles" className={`${buttonStyles.base} ${buttonStyles.ghost} w-full`}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
            />
          </svg>
          Switch Profile
        </Link>
      </div>

      {/* Name Modal */}
      {showNameModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowNameModal(false)}
        >
          <div
            className="bg-surface border border-border rounded-xl shadow-xl w-full max-w-sm mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-foreground mb-4">Change Name</h2>

            <div className="mb-5">
              <label className="block text-sm text-foreground-muted mb-1">Name</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleNameSave();
                }}
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowNameModal(false)}
                className={`${buttonStyles.base} ${buttonStyles.ghost} flex-1`}
                disabled={nameSaving}
              >
                Cancel
              </button>
              <button
                onClick={handleNameSave}
                disabled={!editName.trim() || editName.trim() === profile.name || nameSaving}
                className={`${buttonStyles.base} ${buttonStyles.primary} flex-1`}
              >
                {nameSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PIN Modal */}
      {showPinModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowPinModal(false)}
        >
          <div
            className="bg-surface border border-border rounded-xl shadow-xl w-full max-w-sm mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-foreground mb-4">
              {profile.hasPin ? "Change PIN" : "Set PIN"}
            </h2>

            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-sm text-foreground-muted mb-1">New 4-digit PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground text-center text-lg tracking-widest"
                  placeholder="••••"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm text-foreground-muted mb-1">Confirm PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground text-center text-lg tracking-widest"
                  placeholder="••••"
                />
              </div>
              {pin.length > 0 && pin.length < 4 && (
                <p className="text-xs text-danger">PIN must be 4 digits</p>
              )}
              {confirmPin.length > 0 && pin !== confirmPin && (
                <p className="text-xs text-danger">PINs do not match</p>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowPinModal(false)}
                className={`${buttonStyles.base} ${buttonStyles.ghost} flex-1`}
                disabled={pinSaving}
              >
                Cancel
              </button>
              <button
                onClick={handlePinSave}
                disabled={pin.length !== 4 || pin !== confirmPin || pinSaving}
                className={`${buttonStyles.base} ${buttonStyles.primary} flex-1`}
              >
                {pinSaving ? "Saving..." : "Save"}
              </button>
            </div>

            {profile.hasPin && (
              <button
                onClick={handlePinRemove}
                disabled={pinSaving}
                className="w-full mt-3 text-sm text-danger hover:text-danger/80 transition-colors py-2"
              >
                Remove PIN
              </button>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
