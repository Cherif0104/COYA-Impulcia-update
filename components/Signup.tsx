import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContextSupabase';
import { useLocalization } from '../contexts/LocalizationContext';
import NexusFlowIcon from './icons/NexusFlowIcon';
import { Role, PUBLIC_ROLES, ROLES_REQUIRING_APPROVAL, Translation } from '../types';
import AuthAIAssistant from './AuthAIAssistant';
import { AuthService } from '../services/authService';
import { logger } from '../services/loggerService';

const PasswordStrengthMeter: React.FC<{ password?: string }> = ({ password = '' }) => {
    const { t } = useLocalization();

    const calculateStrength = () => {
        let score = 0;
        if (password.length > 7) score++;
        if (password.length > 10) score++;
        if (/[A-Z]/.test(password)) score++;
        if (/[0-9]/.test(password)) score++;
        if (/[^A-Za-z0-9]/.test(password)) score++;
        return Math.floor(score / 1.25); // Scale score to 0-4
    };

    const strength = calculateStrength();
    const strengthLabels = [t('strength_weak'), t('strength_weak'), t('strength_medium'), t('strength_strong'), t('strength_very_strong')];
    const strengthColors = ['bg-red-500', 'bg-red-500', 'bg-yellow-500', 'bg-emerald-500', 'bg-emerald-600'];

    return (
        <div>
            <div className="flex justify-between items-center text-xs mb-1">
                <span className="font-medium text-gray-600">{t('password_strength')}</span>
                <span className={`font-semibold ${strength > 1 ? 'text-gray-800' : 'text-gray-500'}`}>{strengthLabels[strength]}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-1.5">
                <div 
                    className={`h-1.5 rounded-full ${strengthColors[strength]} transition-all duration-300`} 
                    style={{ width: `${(strength / 4) * 100}%`}}
                ></div>
            </div>
        </div>
    );
};

interface SignupProps {
  onSwitchToLogin: () => void;
  onSignupSuccess?: () => void;
}

const HERO_HIGHLIGHTS: Array<{ icon: string; titleKey: keyof Translation; descriptionKey: keyof Translation }> = [
  {
    icon: 'fas fa-building',
    titleKey: 'signup_highlight_multi_org_title',
    descriptionKey: 'signup_highlight_multi_org_description',
  },
  {
    icon: 'fas fa-users',
    titleKey: 'signup_highlight_unified_title',
    descriptionKey: 'signup_highlight_unified_description',
  },
  {
    icon: 'fas fa-shield-alt',
    titleKey: 'signup_highlight_security_title',
    descriptionKey: 'signup_highlight_security_description',
  },
];

const ROLE_CATEGORY_LABELS: Record<string, { icon: string; labelKey: keyof Translation }> = {
  'Gestion': { icon: '🏢', labelKey: 'signup_role_group_management' },
  'Pédagogique & Facilitation': { icon: '👨‍🏫', labelKey: 'signup_role_group_pedagogy' },
  'Jeunesse & Académique': { icon: '👨‍🎓', labelKey: 'signup_role_group_youth' },
  'Entrepreneuriat & Partenariats': { icon: '🤝', labelKey: 'signup_role_group_entrepreneurship' },
  'Créatif & Médias': { icon: '🎨', labelKey: 'signup_role_group_creative' },
  'Facilitateurs partenaires': { icon: '🤝', labelKey: 'signup_role_group_partners' },
  'Super Administration': { icon: '⭐', labelKey: 'signup_role_group_super_admin' },
};

const Signup: React.FC<SignupProps> = ({ onSwitchToLogin, onSignupSuccess }) => {
  const { t } = useLocalization();
  const { signUp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<Role>('student'); // Rôle par défaut public
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState<string>('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isAssistantOpen, setAssistantOpen] = useState(false);
  const [assistantInitialPrompt, setAssistantInitialPrompt] = useState('');
  const [roleAvailability, setRoleAvailability] = useState<Record<string, { available: boolean; reason?: string }>>({});
  const [loadingRoles, setLoadingRoles] = useState(true);
  // Organisation (nom/slug) – création automatique si inexistante (si autorisé)
  const [organizationName, setOrganizationName] = useState('SENEGEL');

  // Rôle unique réservé (super_administrator uniquement)
  // Liste complète de tous les rôles disponibles organisés par catégorie
  const ALL_ROLES: Record<string, Role[]> = {
    'Gestion': ['administrator', 'manager', 'supervisor', 'intern'],
    'Pédagogique & Facilitation': ['trainer', 'coach', 'facilitator', 'mentor'],
    'Jeunesse & Académique': ['student', 'alumni'],
    'Entrepreneuriat & Partenariats': ['entrepreneur', 'employer', 'implementer', 'funder'],
    'Créatif & Médias': ['publisher', 'editor', 'producer', 'artist'],
    'Facilitateurs partenaires': ['partner_facilitator'],
    'Super Administration': ['super_administrator']
  };

  // Charger la disponibilité des rôles au montage
  useEffect(() => {
    const loadRoleAvailability = async () => {
      try {
        setLoadingRoles(true);
        const availability: Record<string, { available: boolean; reason?: string }> = {};

        // Tous les rôles sont disponibles (validation en aval pour les rôles sensibles)
        Object.values(ALL_ROLES).flat().forEach(role => {
          availability[role] = { available: true };
        });

        // Ajouter aussi les rôles publics pour compatibilité
        PUBLIC_ROLES.forEach(role => {
          if (!availability[role]) {
            availability[role] = { available: true };
          }
        });

        setRoleAvailability(availability);
      } catch (error) {
        console.error('Erreur chargement disponibilité rôles:', error);
      } finally {
        setLoadingRoles(false);
      }
    };

    loadRoleAvailability();
  }, []);

  const isRoleAvailable = (roleValue: string): boolean => {
    return roleAvailability[roleValue]?.available !== false;
  };

  const getRoleReason = (roleValue: string): string | undefined => {
    return roleAvailability[roleValue]?.reason;
  };

  const formatSignupError = (err: any): string => {
    const defaultMessage = t('signup_error_generic');
    if (!err) {
      return defaultMessage;
    }

    const rawMessage =
      typeof err === 'string'
        ? err
        : err?.message || err?.error_description || defaultMessage;

    const normalized = (rawMessage || '').toLowerCase();

    if (normalized.includes('already registered') || normalized.includes('duplicate')) {
      return t('signup_error_email_exists');
    }

    if (normalized.includes('invalid email')) {
      return t('signup_error_invalid_email');
    }

    if (normalized.includes('password should be at least')) {
      return t('signup_error_password_short');
    }

    return rawMessage || defaultMessage;
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (password !== confirmPassword) {
      setError(t('passwords_do_not_match'));
      return;
    }

    if (password.length < 8) {
      setError(t('signup_password_min_length'));
      return;
    }

    // Vérifier que le rôle est disponible
    if (!isRoleAvailable(role)) {
      setError(getRoleReason(role) || t('signup_role_unavailable').replace('{role}', t(role)));
      return;
    }

    setLoading(true);
    setError('');
    setEmailError('');

    // Ne pas créer d'organisation avant authentification
    // On utilise SENEGEL par défaut; si une autre organisation est saisie,
    // l'alignement sera fait à la première connexion (Login harmonise déjà)
    const targetName = (organizationName || 'SENEGEL').trim();
    const SENEGEL_ORG_ID = 'fb782f1a-ee3c-4665-99f2-baec16687fe1';
    const organizationIdToUse = targetName.toLowerCase() === 'senegel' ? SENEGEL_ORG_ID : SENEGEL_ORG_ID;

    logger.logAuth('Tentative inscription', { email, role, organizationName: targetName });
    const result = await signUp(email, password, name, phone, role, organizationIdToUse);
    
    if (!result.success) {
      const friendly = formatSignupError(result.error);
      logger.error('auth', 'Erreur inscription', result.error);
      
      // Messages d'erreur plus clairs
      if (
        friendly.toLowerCase().includes('déjà utilisée') ||
        friendly.toLowerCase().includes('déjà utilisé') ||
        friendly.toLowerCase().includes('duplicate') ||
        friendly.toLowerCase().includes('already')
      ) {
        setEmailError(t('signup_email_in_use_detailed'));
        setError('');
      } else if (friendly.toLowerCase().includes('email invalide') || friendly.toLowerCase().includes('invalid email')) {
        setEmailError('');
        setError(t('signup_invalid_email_hint'));
      } else {
        setEmailError('');
        setError(friendly);
      }
    } else {
      // Inscription réussie → redirection immédiate vers Login (évite l'écran blanc)
      logger.logAuth('Inscription réussie', { email });
      logger.info('navigation', 'Redirection vers login après inscription');

      try {
        // 1) Utiliser le switch fourni par le parent si disponible
        onSwitchToLogin?.();

        // 2) Fallback forcé (SPA / production): redirection explicite
        //    Évite tout état intermédiaire "waiting for auth"
        setTimeout(() => {
          if (typeof window !== 'undefined') {
            // Conserver la vue voulue après connexion
            try { localStorage.setItem('currentView', 'login'); } catch {}
            window.location.href = '/login';
          }
        }, 0);
      } catch (e) {
        // Dernier recours
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
      }
    }
    
    setLoading(false);
  };

  const openAssistant = (prompt: string = '') => {
    setAssistantInitialPrompt(prompt);
    setAssistantOpen(true);
  }

  return (
    <>
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="w-full max-w-4xl mx-auto bg-white rounded-2xl shadow-xl overflow-hidden md:flex">
          {/* Left Panel */}
          <div className="md:w-1/2 bg-gradient-to-br from-emerald-600 to-blue-600 text-white p-12 flex flex-col justify-center items-center text-center">
            <NexusFlowIcon className="w-28 h-28"/>
            <h1 className="text-3xl font-bold mt-4">COYA</h1>
            <p className="mt-2 text-emerald-100 text-sm font-medium">{t('signup_hero_tagline')}</p>
            <p className="mt-1 text-emerald-50 text-lg">{t('signup_hero_subtagline')}</p>
            <div className="mt-8 space-y-4 text-sm text-emerald-50">
              {HERO_HIGHLIGHTS.map((highlight) => (
                <div key={highlight.titleKey as string} className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
                  <i className={`${highlight.icon} text-2xl mb-2`}></i>
                  <h3 className="font-semibold mb-2">{t(highlight.titleKey)}</h3>
                  <p className="text-xs">{t(highlight.descriptionKey)}</p>
              </div>
              ))}
            </div>
          </div>

          {/* Right Panel */}
          <div className="md:w-1/2 p-8 md:p-12">
            <h2 className="text-3xl font-bold text-gray-900">{t('signup_title')}</h2>
            <form className="mt-8 space-y-6" onSubmit={handleSignup}>
              {/* Organisation (nom) */}
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('signup_organization_label')}</label>
                <input
                  type="text"
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 sm:text-sm"
                  placeholder={t('signup_organization_placeholder')}
                />
                <p className="mt-2 text-xs text-gray-500">
                  {t('signup_organization_hint')}
                </p>
              </div>
              {/* Bannière informative */}
              <div className={`bg-gradient-to-r ${organizationName.trim().toLowerCase() === 'senegel' ? 'from-emerald-50 to-green-50 border-emerald-200' : 'from-blue-50 to-cyan-50 border-blue-200'} border rounded-lg p-4 mb-4`}>
                <div className="flex items-start">
                  <div className="flex-shrink-0">
                    <i className={`fas fa-info-circle ${organizationName.trim().toLowerCase() === 'senegel' ? 'text-emerald-600' : 'text-blue-600'} text-xl mt-1`}></i>
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-semibold text-gray-900 mb-1">🏢 {t('signup_banner_title')}</h3>
                    <p className="text-xs text-gray-700 mb-2">
                      {t('signup_banner_description_prefix')} <strong>{organizationName || 'SENEGEL'}</strong>. {t('signup_banner_description_suffix')}
                    </p>
                    <p className="text-xs text-gray-600 mb-2">
                      <i className="fas fa-check-circle mr-1 text-emerald-600"></i>
                      <strong>{t('signup_banner_all_roles_label')}</strong> {t('signup_banner_all_roles_description')}
                    </p>
                    <p className="text-xs text-gray-600">
                      <i className="fas fa-lock mr-1"></i>
                      <strong>{t('signup_banner_note_label')}</strong> {t('signup_banner_note_description')}
                    </p>
                  </div>
                </div>
              </div>
              
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md">
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                  {t('full_name')}
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 sm:text-sm"
                  placeholder={t('signup_full_name_placeholder')}
                />
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                  {t('email')}
                </label>
                {emailError && (
                  <div className="mt-1 mb-1 bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded">
                    <i className="fas fa-exclamation-circle mr-1"></i>
                    {emailError}
                  </div>
                )}
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 sm:text-sm"
                  placeholder={t('signup_email_placeholder')}
                />
                <p className="mt-1 text-xs text-gray-500">
                  {t('signup_email_domain_warning')}
                </p>
              </div>

              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-gray-700">
                  {t('phone_number')}
                </label>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 sm:text-sm"
                  placeholder={t('signup_phone_placeholder')}
                />
              </div>

              <div>
                <label htmlFor="role" className="block text-sm font-medium text-gray-700">
                  {t('signup_role_label')}
                </label>
                <select
                  id="role"
                  name="role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                  className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 sm:text-sm rounded-md"
                >
                  {/* Afficher tous les rôles organisés par catégorie */}
                  {Object.entries(ALL_ROLES).map(([category, roles]) => {
                    const config = ROLE_CATEGORY_LABELS[category];
                    const label = config ? `${config.icon} ${t(config.labelKey)}` : category;
                    return (
                      <optgroup key={category} label={label}>
                        {roles.map(roleValue => (
                          isRoleAvailable(roleValue) && (
                            <option key={roleValue} value={roleValue}>
                              {t(roleValue)}
                            </option>
                          )
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  {t('signup_poste_note')}
                </p>
                {ROLES_REQUIRING_APPROVAL.includes(role) && (
                  <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 flex gap-2">
                    <i className="fas fa-shield-alt mt-0.5"></i>
                    <span>{t('signup_role_requires_validation_message')}</span>
                  </div>
                )}
                <div className="mt-3 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <p className="text-sm font-semibold text-emerald-800 mb-2">
                    <i className="fas fa-check-circle mr-2"></i>
                    {t('signup_all_roles_card_title')}
                  </p>
                  <p className="text-xs text-emerald-700 mb-2">
                    {t('signup_all_roles_card_description')}
                  </p>
                  <div className="text-xs text-emerald-600 space-y-1">
                    <p><strong>{t('signup_roles_management_label')}</strong> administrator, manager, supervisor, intern</p>
                    <p><strong>{t('signup_roles_pedagogy_label')}</strong> trainer, coach, facilitator, mentor</p>
                    <p><strong>{t('signup_roles_youth_label')}</strong> student, alumni</p>
                    <p><strong>{t('signup_roles_entrepreneurship_label')}</strong> entrepreneur, employer, implementer, funder</p>
                    <p><strong>{t('signup_roles_creative_label')}</strong> publisher, editor, producer, artist</p>
                    <p><strong>{t('signup_roles_partner_label')}</strong> partner_facilitator</p>
                    <p><strong>{t('signup_roles_super_admin_label')}</strong> super_administrator</p>
                  </div>
                  <p className="text-xs text-emerald-700 mt-2">
                    <i className="fas fa-info-circle mr-1"></i>
                    {t('signup_roles_note_text')}
                  </p>
                </div>
                {role && (
                  <p className="mt-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800">
                    <i className="fas fa-user-check mr-2"></i>
                    <strong>{ROLES_REQUIRING_APPROVAL.includes(role) ? t('signup_role_status_validation') : t('signup_role_status_allowed')}</strong><br/>
                    {ROLES_REQUIRING_APPROVAL.includes(role)
                      ? t('signup_role_status_validation_message').replace('{role}', t(role))
                      : t('signup_role_status_allowed_message').replace('{role}', t(role))}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                  {t('password')}
                </label>
                <div className="mt-1 relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 sm:text-sm pr-10"
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-500 hover:text-gray-700 focus:outline-none"
                    aria-label={showPassword ? t('signup_hide_password') : t('signup_show_password')}
                  >
                    <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                  </button>
                </div>
                <PasswordStrengthMeter password={password} />
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
                  {t('confirm_password')}
                </label>
                <div className="mt-1 relative">
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 sm:text-sm pr-10"
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-500 hover:text-gray-700 focus:outline-none"
                    aria-label={showConfirmPassword ? t('signup_hide_confirm_password') : t('signup_show_confirm_password')}
                  >
                    <i className={`fas ${showConfirmPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                  </button>
                </div>
              </div>

              <div>
                <button
                  type="submit"
                  disabled={loading}
                  className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? t('signup_loading') : t('signup_button')}
                </button>
              </div>

              <div className="text-center">
                <span className="text-sm text-gray-600">
                  {t('signup_prompt')}{' '}
                  <button
                    type="button"
                    onClick={onSwitchToLogin}
                    className="text-emerald-600 hover:text-emerald-500 font-medium"
                  >
                    {t('login_prompt')}
                  </button>
                </span>
              </div>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => openAssistant(t('auth_ai_prompt_roles'))}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  {t('need_help')}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {isAssistantOpen && (
        <AuthAIAssistant
          isOpen={isAssistantOpen}
          onClose={() => setAssistantOpen(false)}
          initialPrompt={assistantInitialPrompt}
        />
      )}
    </>
  );
};

export default Signup;
