import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContextSupabase';
import { useLocalization } from '../contexts/LocalizationContext';
import { Language } from '../types';
import NotificationCenter from './common/NotificationCenter';
import { Notification } from '../services/notificationService';
import { useModuleLabels } from '../hooks/useModuleLabels';
import { moduleDisplayNames } from './UserModulePermissions';

interface HeaderProps {
  toggleSidebar: () => void;
  setView: (view: string) => void;
  onNotificationNavigate: (notification: Notification) => void;
  onShowAllNotifications?: () => void;
  onShowActivityLogs?: () => void;
  currentView?: string;
  /** Dock pointage global (Workforce Runtime) — sous `PresenceProvider`. */
  workforceDock?: React.ReactNode;
}

/**
 * Header aligné textuellement sur `make figma/src/app/components/Layout.tsx`
 * - Hauteur 64px (`h-16`), fond blanc, ombre légère, bordure basse.
 * - À gauche : bouton burger mobile, titre de la page courante + date.
 * - À droite : barre de recherche, notifications, paramètres, avatar.
 */

/** Libellés titre header : alignés sur `moduleDisplayNames` + clés de vue non-modules. */
const VIEW_LABELS: Record<string, string> = {
  ...moduleDisplayNames,
  programmes_projects: 'Programmes & Projets',
  formation: moduleDisplayNames.courses,
  apex: moduleDisplayNames.courses,
  course_detail: moduleDisplayNames.courses,
  goals: 'Objectifs',
  employee_workspace: 'Espace salarié',
  project_workspace: 'Espace projet',
  pending_access: 'Accès en attente',
  notifications_center: 'Notifications',
  activity_logs: 'Journal d\u2019activité',
  drive: 'Drive',
};

const Header: React.FC<HeaderProps> = ({
  toggleSidebar,
  setView,
  onNotificationNavigate,
  onShowAllNotifications,
  onShowActivityLogs,
  currentView,
  workforceDock,
}) => {
  const { user, signOut } = useAuth();
  const { language, setLanguage, t } = useLocalization();
  const { getDisplayName } = useModuleLabels();
  const [isProfileOpen, setProfileOpen] = useState(false);
  const [isLangOpen, setLangOpen] = useState(false);

  if (!user) return null;

  const handleNavigate = (view: string) => {
    setView(view);
    setProfileOpen(false);
  };

  const dateLabel = new Date().toLocaleDateString(language === Language.FR ? 'fr-FR' : 'en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const mobilityHubTitle =
    language === Language.FR ? 'Demande mobilité' : 'Mobility request';

  const pageLabel =
    (currentView &&
      (getDisplayName(currentView) ||
        (currentView === 'demande_mobilite' ? mobilityHubTitle : undefined) ||
        VIEW_LABELS[currentView])) ||
    VIEW_LABELS[currentView || ''] ||
    'COYA';

  const userInitials = user.name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'U';

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-gray-100 bg-white px-4 shadow-[0_1px_0_0_rgba(13,122,43,0.06)] lg:px-6">
      <div className="flex items-center gap-4 min-w-0">
        <button
          type="button"
          onClick={toggleSidebar}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 hover:bg-gray-50 lg:hidden"
          aria-label="Ouvrir le menu"
        >
          <i className="fas fa-bars text-gray-600" />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold leading-none text-gray-900">{pageLabel}</h1>
          <p className="mt-0.5 truncate text-xs text-gray-400 capitalize">{dateLabel}</p>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-3">
        {workforceDock ? <div className="hidden min-w-0 shrink lg:block">{workforceDock}</div> : null}
        <div className="hidden items-center gap-2 rounded-xl bg-gray-100 px-3 py-2 md:flex w-64 max-w-[40vw] lg:max-w-xs">
          <i className="fas fa-search text-xs text-gray-400" />
          <input
            type="text"
            placeholder={
              currentView === 'apex' ||
              currentView === 'formation' ||
              currentView === 'courses' ||
              currentView?.startsWith('course')
                ? 'Rechercher un parcours APEX, un apprenant…'
                : 'Rechercher…'
            }
            className="w-full bg-transparent text-sm text-gray-600 placeholder-gray-400 outline-none border-0 p-0 focus:ring-0"
          />
        </div>

        <NotificationCenter
          onNavigate={(notification) => {
            if (notification.id === 'notifications-center') {
              onShowAllNotifications?.();
            } else {
              onNotificationNavigate(notification);
            }
          }}
          onShowActivityLogs={onShowActivityLogs}
        />

        <div className="relative">
          <button
            type="button"
            onClick={() => setLangOpen((v) => !v)}
            className="flex h-9 items-center gap-1.5 rounded-xl border border-gray-200 px-2.5 text-gray-600 transition-colors hover:bg-gray-50"
          >
            <i className="fas fa-globe text-[13px]" />
            <span className="hidden text-xs font-semibold sm:inline">{language.toUpperCase()}</span>
            <i className="fas fa-chevron-down text-[9px]" />
          </button>
          {isLangOpen && (
            <div className="absolute right-0 mt-2 w-36 rounded-xl border border-gray-200 bg-white py-1 shadow-lg z-50">
              <button
                type="button"
                onClick={() => { setLanguage(Language.EN); setLangOpen(false); }}
                className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
              >
                {t('english')}
              </button>
              <button
                type="button"
                onClick={() => { setLanguage(Language.FR); setLangOpen(false); }}
                className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
              >
                {t('french')}
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => handleNavigate('settings')}
          className="hidden h-9 w-9 items-center justify-center rounded-xl border border-gray-200 text-gray-600 transition-colors hover:bg-gray-50 sm:flex"
          aria-label="Paramètres"
        >
          <i className="fas fa-cog text-[13px]" />
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setProfileOpen((v) => !v)}
            className="flex items-center gap-2 rounded-full transition-colors hover:opacity-90"
          >
            {user?.avatar && !user.avatar.startsWith('data:image') ? (
              <img
                src={user.avatar}
                alt={user.name}
                className="h-9 w-9 rounded-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.nextElementSibling?.classList.remove('hidden');
                }}
              />
            ) : null}
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-coya-institutional to-coya-institutional-secondary text-xs font-bold text-white ring-2 ring-white shadow-sm ${
                user?.avatar && !user.avatar.startsWith('data:image') ? 'hidden' : ''
              }`}
            >
              {userInitials}
            </div>
          </button>
          {isProfileOpen && (
            <div className="absolute right-0 mt-2 w-48 rounded-xl border border-gray-200 bg-white py-1 shadow-lg z-50">
              <div className="px-4 py-2 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-900 truncate">{user.name}</p>
                <p className="text-xs text-gray-500 truncate">{user.email}</p>
              </div>
              <button
                type="button"
                onClick={() => handleNavigate('settings')}
                className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
              >
                <i className="fas fa-user mr-2 w-4 text-[12px] text-gray-400" /> {t('profile')}
              </button>
              <button
                type="button"
                onClick={() => handleNavigate('settings')}
                className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
              >
                <i className="fas fa-cog mr-2 w-4 text-[12px] text-gray-400" /> {t('settings')}
              </button>
              <button
                type="button"
                onClick={() => signOut()}
                className="block w-full px-4 py-2 text-left text-sm text-red-500 hover:bg-gray-50"
              >
                <i className="fas fa-sign-out-alt mr-2 w-4 text-[12px]" /> {t('logout')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
