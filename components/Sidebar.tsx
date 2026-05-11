import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocalization } from '../contexts/LocalizationContext';
import { Language, ModuleName } from '../types';
import { useModuleLabels } from '../hooks/useModuleLabels';
import { useAuth } from '../contexts/AuthContextSupabase';
import { NAV_SESSION_FORMATION_SECTION } from '../contexts/AppNavigationContext';
import {
  FORMATION_SIDEBAR_ITEMS,
  parseFormationSectionFromHash,
  pushFormationSectionToUrl,
  type FormationHubSection,
} from '../utils/formationNav';

/** Casse homogène pour le menu : type « titre » par mot, sigles courants conservés. */
function formatSidebarMenuLabel(raw: string, language: Language): string {
  const s = raw.trim().replace(/\s+/g, ' ');
  if (!s) return s;
  const loc = language === Language.FR ? 'fr-FR' : 'en-US';
  const ACRONYMS: Record<string, string> = {
    crm: 'CRM',
    it: 'IT',
    rh: 'RH',
    daf: 'DAF',
    coya: 'COYA',
    erp: 'ERP',
    api: 'API',
  };
  return s.split(/(\s+)/).map((seg) => {
    if (/^\s+$/.test(seg)) return seg;
    if (!/[\p{L}\p{N}]/u.test(seg)) return seg;
    const alnum = seg.replace(/[^\p{L}\p{N}]/gu, '');
    if (!alnum) return seg;
    const key = alnum.toLocaleLowerCase(loc);
    if (ACRONYMS[key]) return seg.replace(alnum, ACRONYMS[key]);
    const lower = seg.toLocaleLowerCase(loc);
    return lower.charAt(0).toLocaleUpperCase(loc) + lower.slice(1);
  }).join('');
}

interface SidebarProps {
  currentView: string;
  setView: (view: string) => void;
  isOpen: boolean;
  canAccessModule: (module: ModuleName) => boolean;
  permissionsLoading: boolean;
  onCloseMobile?: () => void;
}

/**
 * Sidebar institutionnelle SENEGEL / MAKE FIGMA.
 * - Fond `--coya-shell-sidebar-bg` (#071018), accents verts institutionnels.
 * - Icônes Lucide avec couleur dédiée par module (active = couleur du module).
 * - Largeur 260px, mode compact 72px (pas dans Figma original mais hérité de la
 *   maquette `Layout.tsx` via le bouton de collapse).
 * - Indicateur actif : barre or institutionnel + fond `bg-white/15`.
 * - Bloc profil utilisateur en pied (avec dropdown).
 */

type SidebarItem = {
  icon: string;        // FontAwesome (existant) — colorisé par accent
  labelKey: string;
  labelFallback: string;
  view: string;
  /** Couleur d'accent (texte) lorsque actif — tokens Figma. */
  color: string;
};

/** Ordre : workspace → opérations → transverse (scroll-friendly). */
const SIDEBAR_ITEMS: SidebarItem[] = [
  { icon: 'fas fa-th-large',         labelKey: 'dashboard',       labelFallback: 'Tableau de Bord',     view: 'dashboard',           color: 'text-blue-400' },
  { icon: 'fas fa-project-diagram',  labelKey: 'projects',        labelFallback: 'Projets',             view: 'projects',            color: 'text-violet-400' },
  { icon: 'fas fa-bullseye',         labelKey: 'goals_okrs',      labelFallback: 'Stratégie & pilotage', view: 'goals_okrs',          color: 'text-amber-400' },
  { icon: 'fas fa-calendar-week',    labelKey: 'planning',        labelFallback: 'Planification',       view: 'planning',            color: 'text-cyan-400' },
  { icon: 'fas fa-umbrella-beach',   labelKey: 'leave_management', labelFallback: 'Congés',             view: 'leave_management',    color: 'text-teal-300' },
  { icon: 'fas fa-users-cog',        labelKey: 'rh',              labelFallback: 'Ressources Humaines', view: 'rh',                  color: 'text-green-400' },
  { icon: 'fas fa-calculator',       labelKey: 'comptabilite',    labelFallback: 'Comptabilité',        view: 'comptabilite',        color: 'text-yellow-400' },
  { icon: 'fas fa-chart-line',       labelKey: 'programme',       labelFallback: 'Programme',           view: 'programme',           color: 'text-orange-400' },
  { icon: 'fas fa-book-open',        labelKey: 'courses',         labelFallback: 'Formations',          view: 'formation',           color: 'text-pink-400' },
  { icon: 'fas fa-briefcase',        labelKey: 'jobs',            labelFallback: 'Offres d\u2019emploi', view: 'jobs',               color: 'text-orange-300' },
  { icon: 'fas fa-users',            labelKey: 'crm_sales',       labelFallback: 'CRM & Ventes',        view: 'crm_sales',           color: 'text-emerald-400' },
  { icon: 'fas fa-gem',              labelKey: 'trinite',         labelFallback: 'Trinité',             view: 'trinite',             color: 'text-red-400' },
  { icon: 'fas fa-boxes',            labelKey: 'logistique',      labelFallback: 'Logistique',          view: 'logistique',          color: 'text-teal-400' },
  { icon: 'fas fa-video',            labelKey: 'studio',          labelFallback: 'Studio',              view: 'studio',              color: 'text-purple-400' },
  { icon: 'fas fa-car',              labelKey: 'parc_auto',       labelFallback: 'Parc Auto',           view: 'parc_auto',           color: 'text-amber-400' },
  { icon: 'fas fa-envelope',         labelKey: 'messagerie',      labelFallback: 'Messagerie',          view: 'messagerie',          color: 'text-sky-400' },
  { icon: 'fas fa-ticket-alt',       labelKey: 'ticket_it',       labelFallback: 'Ticket IT',           view: 'ticket_it',           color: 'text-rose-400' },
  { icon: 'fas fa-folder-open',      labelKey: 'coya_drive',      labelFallback: 'COYA Drive',        view: 'coya_drive',          color: 'text-indigo-400' },
  { icon: 'fas fa-clipboard-check',  labelKey: 'daf_services',    labelFallback: 'Moyens Généraux',     view: 'daf_services',        color: 'text-lime-400' },
  { icon: 'fas fa-check-double',     labelKey: 'qualite',         labelFallback: 'Qualité',             view: 'qualite',             color: 'text-green-300' },
  { icon: 'fas fa-poll-h',           labelKey: 'collecte',        labelFallback: 'Collecte',            view: 'collecte',            color: 'text-cyan-300' },
];

const NAV_ITEM_BASE = 'group relative flex items-center gap-3 rounded-xl transition-all duration-200';

const NavItem: React.FC<{
  item: SidebarItem;
  active: boolean;
  collapsed: boolean;
  label: string;
  onClick: () => void;
  dataTestId?: string;
}> = ({ item, active, collapsed, label, onClick, dataTestId }) => {
  return (
    <button
      type="button"
      data-testid={dataTestId}
      title={collapsed ? label : ''}
      onClick={onClick}
      className={`${NAV_ITEM_BASE} w-full text-left ${collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5'} ${
        active ? 'bg-white/15 shadow-sm' : 'hover:bg-white/10'
      }`}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-coya-institutional-accent shadow-[0_0_12px_rgba(244,196,48,0.35)]" />
      )}
      <i
        className={`${item.icon} w-5 shrink-0 text-center text-[14px] transition-colors ${
          active ? item.color : 'text-white/50 group-hover:text-white/80'
        }`}
      />
      {!collapsed && (
        <span
          className={`truncate text-sm transition-colors ${
            active ? 'text-white font-medium' : 'text-white/65 group-hover:text-white/90'
          }`}
        >
          {label}
        </span>
      )}
    </button>
  );
};

const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  setView,
  isOpen,
  canAccessModule,
  permissionsLoading,
  onCloseMobile,
}) => {
  const { t, language } = useLocalization();
  const { getDisplayName } = useModuleLabels();
  const { user, signOut } = useAuth();
  const asideRef = useRef<HTMLElement>(null);

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('coya_sidebar_collapsed') === '1';
  });
  /** Menu réduit : dépliage temporaire au survol (desktop), refermé après clic hors sidebar ou navigation. */
  const [hoverPeekOpen, setHoverPeekOpen] = useState(false);
  const [isDesktopNav, setIsDesktopNav] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : false,
  );
  const [profileOpen, setProfileOpen] = useState(false);
  const [formationNavExpanded, setFormationNavExpanded] = useState(true);
  const [formationHashSection, setFormationHashSection] = useState<FormationHubSection | null>(() =>
    typeof window !== 'undefined' ? parseFormationSectionFromHash() : null,
  );

  useEffect(() => {
    const syncFormationHash = () => {
      setFormationHashSection(parseFormationSectionFromHash());
    };
    window.addEventListener('hashchange', syncFormationHash);
    window.addEventListener('coya-formation-section', syncFormationHash as EventListener);
    return () => {
      window.removeEventListener('hashchange', syncFormationHash);
      window.removeEventListener('coya-formation-section', syncFormationHash as EventListener);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => setIsDesktopNav(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!collapsed) setHoverPeekOpen(false);
  }, [collapsed]);

  useEffect(() => {
    if (!isDesktopNav) setHoverPeekOpen(false);
  }, [isDesktopNav]);

  useEffect(() => {
    if (!collapsed || !hoverPeekOpen) return;
    const close = (e: PointerEvent) => {
      const root = asideRef.current;
      if (!root || root.contains(e.target as Node)) return;
      setHoverPeekOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [collapsed, hoverPeekOpen]);

  useEffect(() => {
    if (!collapsed || !hoverPeekOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHoverPeekOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [collapsed, hoverPeekOpen]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('coya_sidebar_collapsed', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
    setHoverPeekOpen(false);
  };

  const allNavItems = useMemo(() => {
    /** Entrée fusionnée sidebar : nécessite programme ET projects (voir `programmes_projects` dans App). */
    const showUnifiedProgrammesProjects =
      canAccessModule('projects') && canAccessModule('programme');
    const out: SidebarItem[] = [];
    for (const item of SIDEBAR_ITEMS) {
      if (showUnifiedProgrammesProjects) {
        if (item.view === 'programme') continue;
        if (item.view === 'projects') {
          out.push({
            icon: 'fas fa-layer-group',
            labelKey: 'programmes_projects',
            labelFallback: 'Programmes & Projets',
            view: 'programmes_projects',
            color: 'text-violet-400',
          });
          continue;
        }
      }
      const moduleForAccess: ModuleName =
        item.view === 'formation'
          ? 'courses'
          : (item.view as ModuleName);
      const allowed = canAccessModule(moduleForAccess);
      if (allowed) out.push(item);
    }
    return out;
  }, [canAccessModule]);

  const settingsItem: SidebarItem = {
    icon: 'fas fa-cog',
    labelKey: 'settings',
    labelFallback: 'Paramètres',
    view: 'settings',
    color: 'text-slate-300',
  };

  const getLabel = (item: { labelKey: string; labelFallback: string }) => {
    let raw: string;
    if (item.labelKey === 'rh') raw = 'Ressources Humaines';
    else if (item.labelKey === 'comptabilite') raw = 'Comptabilité';
    else if (item.labelKey === 'programmes_projects') raw = 'Programmes & Projets';
    else raw = getDisplayName(item.labelKey) || t(item.labelKey) || item.labelFallback;
    return formatSidebarMenuLabel(raw, language);
  };

  const isItemActive = (view: string) => {
    if (view === 'projects' && (currentView === 'projects' || currentView.startsWith('project'))) return true;
    if (
      view === 'programmes_projects' &&
      (currentView === 'programmes_projects' ||
        currentView === 'projects' ||
        currentView === 'programme' ||
        currentView === 'project_workspace')
    ) {
      return true;
    }
    if (
      view === 'formation' &&
      (currentView === 'formation' ||
        currentView === 'courses' ||
        currentView.startsWith('course'))
    ) {
      return true;
    }
    return currentView === view;
  };

  useEffect(() => {
    const formationActive =
      currentView === 'formation' ||
      currentView === 'courses' ||
      currentView.startsWith('course');
    if (formationActive) setFormationNavExpanded(true);
  }, [currentView]);

  const formationSidebarActiveSection: FormationHubSection =
    formationHashSection ?? 'overview';

  const userInitials = (user?.name || 'U')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const effectiveCollapsed = collapsed && !(isDesktopNav && hoverPeekOpen);

  const handleAsidePointerEnter = () => {
    if (isDesktopNav && collapsed) setHoverPeekOpen(true);
  };

  return (
    <aside
      ref={asideRef}
      onPointerEnter={handleAsidePointerEnter}
      className={`fixed lg:relative z-50 flex h-full min-h-0 flex-col overflow-visible text-white transition-all duration-300 ease-in-out ${
        effectiveCollapsed ? 'w-[72px]' : 'w-[260px]'
      } ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      style={{ backgroundColor: 'var(--coya-shell-sidebar-bg)' }}
    >
      {/* Logo */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-5">
        {!effectiveCollapsed ? (
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-coya-institutional to-coya-institutional-secondary shadow-[0_8px_24px_rgba(13,122,43,0.35)] shrink-0">
              <span className="text-lg font-bold text-white">C</span>
            </div>
            <div className="min-w-0">
              <span className="block truncate text-xl font-bold tracking-wide text-white">COYA</span>
              <p className="mt-0.5 text-[10px] leading-none text-white/40">ERP Management</p>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-coya-institutional to-coya-institutional-secondary shadow-[0_8px_24px_rgba(13,122,43,0.35)]">
            <span className="text-lg font-bold text-white">C</span>
          </div>
        )}
        <button
          type="button"
          onClick={toggleCollapsed}
          className="ml-auto hidden h-7 w-7 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20 lg:flex"
          aria-label={collapsed ? 'Étendre le menu' : 'Réduire le menu'}
        >
          <i className={`fas fa-chevron-${collapsed ? 'right' : 'left'} text-[10px]`} />
        </button>
        <button
          type="button"
          onClick={onCloseMobile}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 lg:hidden"
          aria-label="Fermer le menu"
        >
          <i className="fas fa-times text-[10px]" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {!effectiveCollapsed && (
          <p className="mb-2 mt-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-white/30">
            Menu Principal
          </p>
        )}
        {permissionsLoading ? (
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          </div>
        ) : (
          <ul className="space-y-0.5">
            {allNavItems.map((item) =>
              item.view === 'formation' && !effectiveCollapsed ? (
                <li key={`${item.view}-${item.labelKey}`} className="space-y-0.5">
                  <div className="flex items-stretch gap-0.5">
                    <div className="min-w-0 flex-1">
                      <NavItem
                        item={item}
                        active={isItemActive(item.view)}
                        collapsed={false}
                        label={getLabel(item)}
                        onClick={() => {
                          try {
                            sessionStorage.setItem(NAV_SESSION_FORMATION_SECTION, 'overview');
                          } catch {
                            /* ignore */
                          }
                          pushFormationSectionToUrl('overview');
                          setView('formation');
                          setFormationNavExpanded(true);
                          onCloseMobile?.();
                          if (collapsed) setHoverPeekOpen(false);
                        }}
                        dataTestId={`nav-${item.view}`}
                      />
                    </div>
                    <button
                      type="button"
                      className="flex w-8 shrink-0 items-center justify-center rounded-xl text-white/50 hover:bg-white/10 hover:text-white/90"
                      aria-expanded={formationNavExpanded}
                      aria-label={formationNavExpanded ? 'Replier le sous-menu Formation' : 'Déplier le sous-menu Formation'}
                      onClick={() => setFormationNavExpanded((v) => !v)}
                    >
                      <i className={`fas fa-chevron-${formationNavExpanded ? 'up' : 'down'} text-[10px]`} />
                    </button>
                  </div>
                  {formationNavExpanded ? (
                    <ul className="ml-2 mt-0.5 space-y-0.5 border-l border-white/10 pl-2">
                      {FORMATION_SIDEBAR_ITEMS.map((sub) => {
                        const subActive =
                          isItemActive('formation') && formationSidebarActiveSection === sub.section;
                        return (
                          <li key={sub.section}>
                            <button
                              type="button"
                              data-testid={`nav-formation-${sub.section}`}
                              onClick={() => {
                                try {
                                  sessionStorage.setItem(NAV_SESSION_FORMATION_SECTION, sub.section);
                                } catch {
                                  /* ignore */
                                }
                                pushFormationSectionToUrl(sub.section);
                                setView('formation');
                                onCloseMobile?.();
                                if (collapsed) setHoverPeekOpen(false);
                              }}
                              className={`flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors ${
                                subActive
                                  ? 'bg-sky-500/25 font-medium text-white'
                                  : 'text-white/55 hover:bg-white/10 hover:text-white/90'
                              }`}
                            >
                              <span className="truncate">{sub.label}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </li>
              ) : item.view === 'formation' && effectiveCollapsed ? (
                <li key={`${item.view}-${item.labelKey}`}>
                  <NavItem
                    item={item}
                    active={isItemActive(item.view)}
                    collapsed
                    label={getLabel(item)}
                    onClick={() => {
                      try {
                        sessionStorage.setItem(NAV_SESSION_FORMATION_SECTION, 'overview');
                      } catch {
                        /* ignore */
                      }
                      pushFormationSectionToUrl('overview');
                      setView('formation');
                      onCloseMobile?.();
                      if (collapsed) setHoverPeekOpen(false);
                    }}
                    dataTestId={`nav-${item.view}`}
                  />
                </li>
              ) : (
                <li key={`${item.view}-${item.labelKey}`}>
                  <NavItem
                    item={item}
                    active={isItemActive(item.view)}
                    collapsed={effectiveCollapsed}
                    label={getLabel(item)}
                    onClick={() => {
                      setView(item.view);
                      onCloseMobile?.();
                      if (collapsed) setHoverPeekOpen(false);
                    }}
                    dataTestId={`nav-${item.view}`}
                  />
                </li>
              ),
            )}
          </ul>
        )}
      </nav>

      {/* Profil */}
      <div className="shrink-0 border-t border-white/10 p-3">
        {!permissionsLoading && canAccessModule(settingsItem.view as ModuleName) && (
          <div className="mb-1">
            <NavItem
              item={settingsItem}
              active={isItemActive(settingsItem.view)}
              collapsed={effectiveCollapsed}
              label={formatSidebarMenuLabel(t('settings') || 'Paramètres', language)}
              onClick={() => {
                setView(settingsItem.view);
                onCloseMobile?.();
                if (collapsed) setHoverPeekOpen(false);
              }}
              dataTestId="nav-settings"
            />
          </div>
        )}
        <button
          type="button"
          onClick={() => setProfileOpen((v) => !v)}
          className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/10 ${
            effectiveCollapsed ? 'justify-center' : ''
          }`}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-coya-institutional to-coya-institutional-secondary ring-2 ring-white/10">
            <span className="text-xs font-bold text-white">{userInitials}</span>
          </div>
          {!effectiveCollapsed && (
            <>
              <div className="flex-1 text-left min-w-0">
                <p className="truncate text-sm font-medium leading-none text-white">{user?.name || 'Utilisateur'}</p>
                <p className="mt-0.5 truncate text-xs text-white/40">{user?.role?.replace(/_/g, ' ') || 'Membre'}</p>
              </div>
              <i className="fas fa-chevron-down text-[10px] text-white/40" />
            </>
          )}
        </button>
        {!effectiveCollapsed && profileOpen && (
          <div className="mt-1 overflow-hidden rounded-xl bg-white/10">
            <button
              type="button"
              onClick={() => {
                setView('settings');
                setProfileOpen(false);
                onCloseMobile?.();
                if (collapsed) setHoverPeekOpen(false);
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <i className="fas fa-user text-[12px]" /> Mon profil
            </button>
            <button
              type="button"
              onClick={() => {
                setView('settings');
                setProfileOpen(false);
                onCloseMobile?.();
                if (collapsed) setHoverPeekOpen(false);
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <i className="fas fa-cog text-[12px]" /> Paramètres
            </button>
            <button
              type="button"
              onClick={() => {
                signOut();
                setProfileOpen(false);
                if (collapsed) setHoverPeekOpen(false);
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-red-400 transition-colors hover:bg-white/10 hover:text-red-300"
            >
              <i className="fas fa-sign-out-alt text-[12px]" /> Déconnexion
            </button>
          </div>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
