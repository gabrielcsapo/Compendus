"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useNavigation, useRouter, useLocation } from "react-flight-router/client";
import { SearchCommandPalette } from "./SearchCommandPalette";
import { DarkModeToggle } from "./DarkModeToggle";
import { GlobalUploadDropzone } from "./GlobalUploadDropzone";
import { SearchInput } from "./SearchInput";
import { Footer } from "./Footer";
import { CompendusLogo } from "./CompendusLogo";

/** Paths that don't require a profile to be selected */
const PROFILE_GATE_SKIP_PATHS = ["/profiles", "/about", "/docs"];

interface ProfileInfo {
  id: string;
  name: string;
  avatar: string | null;
  isAdmin: boolean;
}

function GlobalNavigationLoadingBar() {
  const navigation = useNavigation();

  if (navigation.state === "idle") return null;

  return (
    <div className="h-1 w-full bg-primary-light overflow-hidden fixed top-0 left-0 z-50 opacity-50">
      <div className="animate-progress origin-[0%_50%] w-full h-full bg-primary" />
    </div>
  );
}

function ProfileDropdown({ profile }: { profile: ProfileInfo }) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("keydown", handleEsc);
    }
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-elevated transition-colors"
        title={`Profile: ${profile.name}`}
      >
        <div className="w-7 h-7 rounded-full bg-surface-elevated border border-border flex items-center justify-center text-sm flex-shrink-0">
          {profile.avatar ? (
            <span>{profile.avatar}</span>
          ) : (
            <span className="text-foreground-muted text-xs font-medium">
              {profile.name.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <span className="text-sm font-medium text-foreground-muted hidden sm:inline">
          {profile.name}
        </span>
        <svg
          className={`w-3.5 h-3.5 text-foreground-muted transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-surface border border-border rounded-xl shadow-xl overflow-hidden z-50">
          {/* Profile Info */}
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-surface-elevated border border-border flex items-center justify-center text-lg flex-shrink-0">
                {profile.avatar ? (
                  <span>{profile.avatar}</span>
                ) : (
                  <span className="text-foreground-muted font-medium">
                    {profile.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{profile.name}</p>
                {profile.isAdmin && (
                  <p className="text-xs text-warning">Admin</p>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="py-1">
            <Link
              to="/profiles"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              Switch Profile
            </Link>

            {profile.isAdmin && (
              <Link
                to="/admin/profiles"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                Manage Profiles
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ClientShell({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<ProfileInfo | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const router = useRouter();
  const location = useLocation();

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch("/api/profiles/me");
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.profile) {
          setProfile(data.profile);
        }
      }
    } catch {
      // No profile session or profiles not set up yet — that is fine
    } finally {
      setProfileLoaded(true);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  // Client-side profile gate: redirect to /profiles if no profile is selected.
  // This catches SPA navigations that bypass the server-side middleware.
  useEffect(() => {
    if (!profileLoaded) return;
    if (profile) return; // Profile is selected, no redirect needed

    const path = location.pathname;
    const shouldSkip = PROFILE_GATE_SKIP_PATHS.some(
      (skip) => path === skip || path.startsWith(skip + "/"),
    );
    if (shouldSkip) return;

    router.navigate("/profiles");
  }, [profileLoaded, profile, location.pathname, router]);

  const isAdmin = profile?.isAdmin ?? true; // Default to showing admin UI when no profile system

  return (
    <>
      <header className="sticky top-0 z-40 backdrop-blur-md bg-background/80 border-b border-border">
        <nav className="container px-6 py-4 mx-auto">
          <ul className="flex gap-2 flex-wrap items-center">
            <li className="font-bold text-xl mr-4">
              <Link
                to="/"
                className="text-primary hover:text-primary-hover transition-colors flex items-center gap-2"
              >
                <CompendusLogo />
                Compendus
              </Link>
            </li>
            <li>
              <Link
                to="/"
                className="px-3 py-2 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors font-medium"
              >
                Library
              </Link>
            </li>
            <li>
              <Link
                to="/collections"
                className="px-3 py-2 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors font-medium"
              >
                Collections
              </Link>
            </li>
            <li>
              <Link
                to="/tags"
                className="px-3 py-2 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors font-medium"
              >
                Tags
              </Link>
            </li>
            <li>
              <Link
                to="/highlights"
                className="px-3 py-2 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors font-medium"
              >
                Highlights
              </Link>
            </li>
            <li>
              <Link
                to="/discover"
                className="px-3 py-2 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors font-medium"
              >
                Discover
              </Link>
            </li>
            <li className="ml-auto">
              <SearchInput />
            </li>
            <li>
              <DarkModeToggle />
            </li>
            {isAdmin && (
              <li>
                <Link
                  to="/admin"
                  className="p-2 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors"
                  title="Admin"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </Link>
              </li>
            )}
            {profileLoaded && profile && (
              <li>
                <ProfileDropdown profile={profile} />
              </li>
            )}
          </ul>
        </nav>
      </header>
      <GlobalNavigationLoadingBar />
      <SearchCommandPalette />
      {isAdmin && <GlobalUploadDropzone />}
      <div className="flex-1">{children}</div>
      <Footer />
    </>
  );
}
