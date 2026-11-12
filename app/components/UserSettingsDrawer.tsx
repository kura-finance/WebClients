"use client";

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useAppStore } from '@/store/useAppStore';
import { useKuraLogout } from '@/components/PrivyAuthBridge';
import { features } from '@/config/features';

type ThemeMode = 'light' | 'dark' | 'system';

interface UserSettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLButtonElement | null>;
}

function getInitialThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  const stored = localStorage.getItem('kura-theme');
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system';
}

function applyThemeMode(mode: ThemeMode) {
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const useDark = mode === 'dark' || (mode === 'system' && prefersDark);
  root.classList.toggle('dark', useDark);
  localStorage.setItem('kura-theme', mode);
}

export default function UserSettingsDrawer({ isOpen, onClose, anchorRef }: UserSettingsDrawerProps) {
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState({ top: 0, right: 0 });
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialThemeMode);
  const [isAppearanceOpen, setIsAppearanceOpen] = useState(false);
  const router = useRouter();
  const userProfile = useAppStore((state) => state.userProfile);
  const logout = useKuraLogout();

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (isOpen && anchorRef?.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      });
    }
  }, [isOpen, anchorRef]);

  useEffect(() => {
    applyThemeMode(themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (themeMode !== 'system') return;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => applyThemeMode('system');

    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [themeMode]);

  const closeDrawer = () => {
    setIsAppearanceOpen(false);
    onClose();
  };

  const handleLogout = async () => {
    await logout();
    closeDrawer();
    router.push('/');
  };

  const handleMenuClick = (callback: () => void) => {
    callback();
    closeDrawer();
  };

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[9998]"
            onClick={closeDrawer}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: position.top,
              right: position.right,
            }}
            className="z-[9999] w-80"
          >
            <Card>
              <CardHeader className="space-y-3">
                <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[var(--kura-primary)] to-[var(--kura-primary-dark)]">
                  {userProfile.avatarUrl ? (
                    <Image src={userProfile.avatarUrl} alt="Avatar" width={56} height={56} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-lg font-bold text-[var(--kura-on-primary)]">
                      {userProfile.displayName?.charAt(0).toUpperCase() || 'U'}
                    </span>
                  )}
                </div>
                <div>
                  <CardTitle className="text-base">{userProfile.displayName || 'User'}</CardTitle>
                  <CardDescription>{userProfile.email}</CardDescription>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <Separator />
                <div className="flex flex-col gap-2">
                  <Button variant="ghost" className="justify-start" onClick={() => handleMenuClick(() => router.push('/settings/profile'))}>
                    Profile
                  </Button>
                  {features.e2ee ? (
                    <Button variant="ghost" className="justify-start" onClick={() => handleMenuClick(() => router.push('/settings/security'))}>
                      Security
                    </Button>
                  ) : null}
                  {features.billing ? (
                    <Button variant="ghost" className="justify-start" onClick={() => handleMenuClick(() => router.push('/settings/plan-billing'))}>
                      Plan & Billing
                    </Button>
                  ) : null}
                  <Button variant="ghost" className="justify-start" asChild>
                    <a href="https://kura-finance.com/privacy" target="_blank" rel="noopener noreferrer">
                      Privacy ↗
                    </a>
                  </Button>
                </div>
                <Separator />
                <div className="relative">
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full justify-between"
                    onClick={() => setIsAppearanceOpen((prev) => !prev)}
                  >
                    <span>Appearance</span>
                    <span className="text-[var(--kura-text-secondary)]">{isAppearanceOpen ? '˅' : '>'}</span>
                  </Button>
                  <AnimatePresence>
                    {isAppearanceOpen && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.96, x: 6 }}
                        animate={{ opacity: 1, scale: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.96, x: 6 }}
                        transition={{ duration: 0.14 }}
                        className="absolute right-[calc(100%+0.5rem)] top-1/2 -translate-y-1/2 w-52 z-[10000]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Card className="shadow-lg">
                          <CardContent className="p-3 space-y-2">
                            <CardDescription className="text-xs uppercase tracking-wide">Theme</CardDescription>
                            <Button
                              type="button"
                              variant={themeMode === 'light' ? 'default' : 'secondary'}
                              className="w-full justify-start"
                              onClick={() => {
                                setThemeMode('light');
                                setIsAppearanceOpen(false);
                              }}
                            >
                              Light
                            </Button>
                            <Button
                              type="button"
                              variant={themeMode === 'dark' ? 'default' : 'secondary'}
                              className="w-full justify-start"
                              onClick={() => {
                                setThemeMode('dark');
                                setIsAppearanceOpen(false);
                              }}
                            >
                              Dark
                            </Button>
                            <Button
                              type="button"
                              variant={themeMode === 'system' ? 'default' : 'secondary'}
                              className="w-full justify-start"
                              onClick={() => {
                                setThemeMode('system');
                                setIsAppearanceOpen(false);
                              }}
                            >
                              System
                            </Button>
                          </CardContent>
                        </Card>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <Separator />
                <Button variant="destructive" className="w-full" onClick={handleLogout}>
                  Log Out
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
