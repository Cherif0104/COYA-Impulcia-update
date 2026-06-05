import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContextSupabase';
import { useLocalization } from '../contexts/LocalizationContext';
import AuthAIAssistant from './AuthAIAssistant';
import logoSenegel from '../assets/logo_senegel.png';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Card, CardContent } from './ui/Card';
import AccessRequestModal from './AccessRequestModal';
// import SenegelUsersList from './SenegelUsersList'; // supprimé

const IMPULCIA_URL = 'https://impulcia-afrique.com/';
const SUPPORT_EMAIL = 'techsupport@senegel.org';
const MAILTO_SUPPORT = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Besoin d\'aide - COYA.PRO')}`;

interface LoginProps {
  onLoginSuccess?: () => void;
  onSwitchToSignup?: () => void;
}

const Login: React.FC<LoginProps> = ({ onLoginSuccess, onSwitchToSignup }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState<string>('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const { signIn } = useAuth();
  const { t } = useLocalization();
  const [isAssistantOpen, setAssistantOpen] = useState(false);
  const [assistantInitialPrompt, setAssistantInitialPrompt] = useState('');
  // const [showUsersList, setShowUsersList] = useState(false);
  const [isHelpOpen, setHelpOpen] = useState(false);
  const [accessRequestOpen, setAccessRequestOpen] = useState(false);
  // Organisation (nom) – création si inexistante (si autorisé)
  const [organizationName, setOrganizationName] = useState('SENEGEL');
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string; slug?: string }>>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);

  useEffect(() => {
    const loadOrgs = async () => {
      try {
        setOrgsLoading(true);
        const { default: OrganizationService } = await import('../services/organizationService');
        const list = await OrganizationService.getActiveOrganizations();
        setOrganizations(list.map(o => ({ id: o.id, name: o.name, slug: o.slug })));
        // Si SENEGEL existe, le sélectionner par défaut
        const senegel = list.find(o => (o.slug || '').toLowerCase() === 'senegel' || o.name.toLowerCase() === 'senegel');
        if (senegel) setOrganizationName(senegel.name);
      } catch (e) {
        console.warn('⚠️ Chargement organisations (non bloquant):', e);
      } finally {
        setOrgsLoading(false);
      }
    };
    loadOrgs();
  }, []);

  useEffect(() => {
    try {
      const savedEmail = localStorage.getItem('coya.login.email');
      const savedRemember = localStorage.getItem('coya.login.remember') !== '0';
      setRememberMe(savedRemember);
      if (savedRemember && savedEmail && !email) {
        setEmail(savedEmail);
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatLoginError = (err: any): string => {
    const defaultMessage = t('login_error_generic');
    if (!err) {
      return defaultMessage;
    }

    const rawMessage =
      typeof err === 'string'
        ? err
        : err?.message || err?.error_description || defaultMessage;

    const normalized = (rawMessage || '').toLowerCase();

    if (
      normalized.includes('invalid login') ||
      normalized.includes('invalid credential') ||
      normalized.includes('invalid email or password')
    ) {
      return t('login_error_invalid_credentials');
    }

    if (normalized.includes('aucun utilisateur') || normalized.includes('user not found')) {
      return t('login_error_account_not_found');
    }

    if (normalized.includes('password')) {
      return t('login_error_wrong_password');
    }

    if (normalized.includes('email not confirmed')) {
      return t('login_error_email_not_confirmed');
    }

    return rawMessage || defaultMessage;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('🔐 Tentative de connexion avec:', { email, password: '***' });
    setLoading(true);
    setError('');
    setEmailError('');

    try {
      try {
        localStorage.setItem('coya.login.remember', rememberMe ? '1' : '0');
        if (rememberMe) {
          localStorage.setItem('coya.login.email', email);
        } else {
          localStorage.removeItem('coya.login.email');
        }
      } catch {
        /* ignore */
      }
      const result = await signIn(email, password);
      console.log('📋 Résultat de connexion:', result);
      
      if (!result.success) {
        const friendly = formatLoginError(result.error);
        
        // Messages d'erreur plus clairs
        if (friendly.toLowerCase().includes('déjà utilisé') || friendly.toLowerCase().includes('already registered')) {
          // Si le backend renvoie ce message (rare en login), montrer l'alerte email
          setEmailError(t('login_email_in_use_error'));
        } else {
          setEmailError('');
          setError(friendly);
        }
        
        console.error('❌ Erreur de connexion:', result.error);
      } else {
        console.log('✅ Connexion réussie !');
        // Harmoniser l'organisation sélectionnée: trouver/créer, puis mettre à jour le profil si nécessaire
        try {
          const { OrganizationService } = await import('../services/organizationService');
          const targetName = (organizationName || 'SENEGEL').trim();
          const org = await OrganizationService.findOrCreateOrganizationByName(targetName);
          if (org) {
            // Récupérer profil courant et mettre à jour organization_id si différent
            const { supabase } = await import('../services/supabaseService');
            const { data: { user: currentUser } } = await supabase.auth.getUser();
            if (currentUser?.id) {
              const { data: profile } = await supabase
                .from('profiles')
                .select('id, organization_id')
                .eq('user_id', currentUser.id)
                .single();
              if (profile && profile.organization_id !== org.id) {
                await supabase
                  .from('profiles')
                  .update({ organization_id: org.id, updated_at: new Date().toISOString() })
                  .eq('user_id', currentUser.id);
              }
            }
          }
        } catch (orgErr) {
          console.warn('⚠️ Harmonisation organisation échouée (non bloquant):', orgErr);
        }
        // Appeler le callback de succès pour la redirection contrôlée
        if (onLoginSuccess) {
          onLoginSuccess();
        }
      }
    } catch (error) {
      console.error('💥 Erreur lors de la connexion:', error);
      setError(t('login_unexpected_error'));
    }
    
    setLoading(false);
  };

  const openAssistant = (prompt: string = '') => {
    setAssistantInitialPrompt(prompt);
    setAssistantOpen(true);
  };

  return (
    <>
      {/* Page de connexion uniquement : plein écran, jamais affichée si déjà connecté (géré par App). */}
      <div className="fixed inset-0 z-[100] font-coya overflow-hidden bg-[#071018]">
        {/* Background cinematic */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(1200px 800px at 20% 20%, rgba(13,122,43,0.25), transparent 60%), radial-gradient(900px 700px at 80% 60%, rgba(25,156,69,0.18), transparent 60%), linear-gradient(180deg, #071018 0%, #0F172A 55%, #071018 100%)',
          }}
          aria-hidden
        />
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.50) 1px, transparent 0)',
            backgroundSize: '28px 28px',
          }}
          aria-hidden
        />

        <div className="relative h-full w-full flex items-stretch">
          {/* Left / Branding */}
          <div className="hidden lg:flex lg:w-[52%] xl:w-[58%] relative overflow-hidden">
            <div className="absolute inset-0" aria-hidden>
              <div className="absolute -top-28 -left-24 h-96 w-96 rounded-full blur-3xl animate-loading-shape" style={{ background: 'rgba(13,122,43,0.26)' }} />
              <div className="absolute -bottom-36 right-0 h-[28rem] w-[28rem] rounded-full blur-3xl animate-loading-shape" style={{ background: 'rgba(244,196,48,0.14)', animationDelay: '-2.5s' }} />
            </div>
            <div className="relative z-10 p-12 xl:p-14 flex flex-col justify-between w-full">
              <div className="space-y-6">
                <div className="inline-flex items-center gap-4">
                  <div className="h-14 w-14 rounded-2xl bg-white/10 border border-white/15 backdrop-blur-md flex items-center justify-center">
                    <img src={logoSenegel} alt="SENEGEL" className="h-10 w-10 object-contain" />
                  </div>
                  <div>
                    <p className="text-white text-lg font-semibold tracking-tight">COYA ERP</p>
                    <p className="text-white/65 text-sm">Plateforme institutionnelle — SENEGEL</p>
                  </div>
                </div>

                <div className="max-w-xl">
                  <p className="text-white text-3xl xl:text-4xl font-semibold tracking-tight leading-tight">
                    Citoyenneté. Transparence. Compétences.
                  </p>
                  <p className="text-white/70 text-sm xl:text-base mt-3 leading-relaxed">
                    Une expérience ERP moderne, sécurisée et cohérente, alignée sur les standards SaaS enterprise.
                  </p>
                </div>
              </div>

              <div className="text-white/55 text-xs">
                © SENEGEL • {new Date().getFullYear()}
              </div>
            </div>
          </div>

          {/* Right / Form */}
          <div className="flex-1 flex items-center justify-center p-4 sm:p-6 lg:p-10">
            <div className="w-full max-w-[420px]">
              <Card className="border-white/10 bg-white/10 backdrop-blur-xl shadow-[0_30px_90px_rgba(0,0,0,0.30)]">
                <CardContent className="p-6 sm:p-7">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="h-12 w-12 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center">
                      <img src={logoSenegel} alt="SENEGEL" className="h-8 w-8 object-contain" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-white text-lg font-semibold leading-tight">{t('login_title') || 'Bienvenue'}</p>
                      <p className="text-white/65 text-sm truncate">Connectez-vous à votre espace COYA ERP</p>
                    </div>
                  </div>

                  <form className="space-y-4" onSubmit={handleLogin}>
                    {error ? (
                      <div data-testid="login-error" className="bg-red-500/15 border border-red-500/25 text-red-50 px-4 py-3 rounded-xl text-sm">
                        {error}
                      </div>
                    ) : null}

                    <div className="space-y-2">
                      <label htmlFor="email" className="block text-sm font-medium text-white/85">
                        {t('email')}
                      </label>
                      {emailError ? (
                        <div className="bg-red-500/15 border border-red-500/25 text-red-50 text-xs px-3 py-2 rounded-xl">
                          <i className="fas fa-exclamation-circle mr-1" /> {emailError}
                        </div>
                      ) : null}
                      <Input
                        id="email"
                        name="email"
                        type="email"
                        data-testid="login-email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="bg-white/90 border-white/15 focus:border-white/30 focus:ring-white/10"
                        placeholder={t('signup_email_placeholder')}
                      />
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="password" className="block text-sm font-medium text-white/85">
                        {t('password')}
                      </label>
                      <Input
                        id="password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        data-testid="login-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="bg-white/90 border-white/15 focus:border-white/30 focus:ring-white/10"
                        placeholder="••••••••"
                        autoComplete="current-password"
                        rightElement={
                          <button
                            type="button"
                            onClick={() => setShowPassword((prev) => !prev)}
                            className="text-gray-500 hover:text-gray-700"
                            aria-label={showPassword ? t('signup_hide_password') : t('signup_show_password')}
                          >
                            <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'} text-sm`} />
                          </button>
                        }
                      />
                    </div>

                    <div className="flex items-center">
                      <label className="inline-flex items-center gap-2 text-sm text-white/70 select-none">
                        <input
                          type="checkbox"
                          checked={rememberMe}
                          onChange={(e) => setRememberMe(e.target.checked)}
                          className="h-4 w-4 rounded border-white/20 bg-white/10 text-[#0D7A2B] focus:ring-white/20"
                        />
                        Se souvenir de moi
                      </label>
                    </div>

                    <div className="pt-2 space-y-2">
                      <Button type="submit" data-testid="login-submit" disabled={loading} className="w-full">
                        {loading ? t('login_loading') : t('login')}
                      </Button>
                      <Button type="button" variant="secondary" className="w-full bg-white/90" disabled>
                        Connexion SSO (bientôt)
                      </Button>
                      <button
                        type="button"
                        onClick={() => setAccessRequestOpen(true)}
                        className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10 transition-colors"
                      >
                        <i className="fas fa-user-plus mr-2" aria-hidden />
                        Devenir utilisateur
                      </button>
                      <p className="text-center text-[11px] text-white/60 flex items-center justify-center gap-1">
                        <i className="fa fa-lock" aria-hidden />
                        Connexion sécurisée
                      </p>
                    </div>

                    <div className="pt-4 border-t border-white/10 space-y-2">
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => setHelpOpen(true)}
                          className="text-xs font-medium text-white/70 hover:text-white underline-offset-4 hover:underline"
                        >
                          Problèmes de connexion
                        </button>
                        <button
                          type="button"
                          onClick={() => (onSwitchToSignup ? onSwitchToSignup() : setAccessRequestOpen(true))}
                          className="text-xs font-medium text-white/70 hover:text-white underline-offset-4 hover:underline"
                        >
                          Je n&apos;ai pas encore de compte
                        </button>
                      </div>
                      <p className="text-center text-xs text-white/55">
                        Solution développée par{' '}
                        <a href={IMPULCIA_URL} target="_blank" rel="noopener noreferrer" className="text-white/75 hover:text-white underline-offset-4 hover:underline">
                          Impulcia Afrique
                        </a>
                      </p>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </div>
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

      <AccessRequestModal
        isOpen={accessRequestOpen}
        onClose={() => setAccessRequestOpen(false)}
        organizations={organizations}
        organizationsLoading={orgsLoading}
        defaultOrganizationId={
          organizations.find((o) => o.name === organizationName)?.id || ''
        }
      />

      {/* Modal Besoin d'aide : style COYA unifié */}
      {isHelpOpen && (
        <>
          <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 font-coya">
            <div
              className="absolute inset-0"
              style={{
                background:
                  'radial-gradient(900px 600px at 25% 20%, rgba(13,122,43,0.22), transparent 60%), linear-gradient(180deg, #071018 0%, #0F172A 55%, #071018 100%)',
              }}
              onClick={() => setHelpOpen(false)}
              aria-hidden
            />
            <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-white/10 backdrop-blur-xl p-6 shadow-[0_30px_90px_rgba(0,0,0,0.30)]" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-white mb-3">Besoin d&apos;aide</h3>
              <p className="text-sm text-white/80 mb-4">
                Pour toute demande d&apos;assistance (accès, mot de passe, problème technique), veuillez vous rapprocher de votre manager afin qu&apos;il effectue une demande via <strong>Tickets IT</strong>.
              </p>
              <p className="text-sm text-white/70 mb-4">
                Contact support :{' '}
                <a href={MAILTO_SUPPORT} className="text-white hover:underline font-medium">
                  {SUPPORT_EMAIL}
                </a>
              </p>
              <div className="flex justify-end">
                <Button type="button" onClick={() => setHelpOpen(false)} variant="primary">
                  Fermer
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

    </>
  );
};

export default Login;


