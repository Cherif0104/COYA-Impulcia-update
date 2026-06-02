import React, { useEffect, useMemo, useState } from 'react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { AuthService } from '../services/authService';
import DepartmentService from '../services/departmentService';
import type { Department } from '../types';

interface OrganizationOption {
  id: string;
  name: string;
  slug?: string;
}

interface AccessRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  organizations: OrganizationOption[];
  organizationsLoading?: boolean;
  /** Pré-sélection éventuelle de l'organisation (nom). */
  defaultOrganizationId?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const AccessRequestModal: React.FC<AccessRequestModalProps> = ({
  isOpen,
  onClose,
  organizations,
  organizationsLoading = false,
  defaultOrganizationId = '',
}) => {
  const [prenom, setPrenom] = useState('');
  const [nom, setNom] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [poste, setPoste] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Réinitialiser à l'ouverture
  useEffect(() => {
    if (!isOpen) return;
    setPrenom('');
    setNom('');
    setEmail('');
    setPhone('');
    setPoste('');
    setOrganizationId(defaultOrganizationId || '');
    setDepartmentId('');
    setDepartments([]);
    setSubmitting(false);
    setError('');
    setSuccess(false);
  }, [isOpen, defaultOrganizationId]);

  // Cascade : charger les piliers (départements) de l'organisation sélectionnée
  useEffect(() => {
    if (!isOpen) return;
    setDepartmentId('');
    setDepartments([]);
    if (!organizationId) return;
    let cancelled = false;
    (async () => {
      try {
        setDepartmentsLoading(true);
        const list = await DepartmentService.getDepartmentsByOrganizationId(organizationId);
        if (!cancelled) setDepartments(list.filter((d) => d.isActive !== false));
      } catch (e) {
        if (!cancelled) setDepartments([]);
        console.warn('⚠️ Chargement des piliers (non bloquant):', e);
      } finally {
        if (!cancelled) setDepartmentsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, organizationId]);

  const pilierEnabled = useMemo(
    () => Boolean(organizationId) && !departmentsLoading && departments.length > 0,
    [organizationId, departmentsLoading, departments.length],
  );

  if (!isOpen) return null;

  const validate = (): string | null => {
    if (!prenom.trim()) return 'Veuillez saisir votre prénom.';
    if (!nom.trim()) return 'Veuillez saisir votre nom.';
    const em = email.trim().toLowerCase();
    if (!em || !EMAIL_REGEX.test(em)) return 'Veuillez saisir une adresse e-mail valide.';
    if (!phone.trim()) return 'Veuillez saisir un numéro de téléphone.';
    if (!poste.trim()) return 'Veuillez préciser le poste / la fonction souhaitée.';
    if (!organizationId) return 'Veuillez sélectionner une organisation.';
    // Le pilier est obligatoire dès qu'au moins un pilier existe pour l'organisation.
    if (departments.length > 0 && !departmentId) return 'Veuillez sélectionner un pilier.';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const fullName = `${prenom.trim()} ${nom.trim()}`.trim();
      const { error: reqError } = await AuthService.requestAccess({
        full_name: fullName,
        email: email.trim().toLowerCase(),
        phone_number: phone.trim() || undefined,
        organization_id: organizationId,
        requested_department_id: departmentId || null,
        requested_poste: poste.trim() || null,
      });
      if (reqError) {
        const raw =
          typeof reqError === 'string'
            ? reqError
            : (reqError as { message?: string })?.message || '';
        const normalized = raw.toLowerCase();
        if (
          normalized.includes('already registered') ||
          normalized.includes('already been registered') ||
          normalized.includes('duplicate') ||
          normalized.includes('user already')
        ) {
          setError('Un compte existe déjà pour cette adresse e-mail. Essayez de vous connecter ou utilisez « Mot de passe oublié ».');
        } else {
          setError(raw || 'Une erreur est survenue. Veuillez réessayer plus tard.');
        }
        return;
      }
      setSuccess(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Une erreur est survenue. Veuillez réessayer plus tard.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = 'bg-white/90 border-white/15 focus:border-white/30 focus:ring-white/10';
  const selectClass =
    'w-full rounded-xl bg-white/90 border border-white/15 px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-white/20 disabled:opacity-60 disabled:cursor-not-allowed';
  const labelClass = 'block text-sm font-medium text-white/85 mb-1';

  return (
    <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 font-coya">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(900px 600px at 25% 20%, rgba(13,122,43,0.22), transparent 60%), linear-gradient(180deg, #071018 0%, #0F172A 55%, #071018 100%)',
        }}
        onClick={onClose}
        aria-hidden
      />
      <div
        className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-white/10 backdrop-blur-xl p-6 shadow-[0_30px_90px_rgba(0,0,0,0.30)]"
        onClick={(e) => e.stopPropagation()}
      >
        {success ? (
          <div className="text-center py-4">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/20 border border-emerald-400/30">
              <i className="fas fa-paper-plane text-2xl text-emerald-300" aria-hidden />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Demande envoyée</h3>
            <p className="text-sm text-white/80 mb-2">
              Votre demande d&apos;accès a bien été transmise. Elle est <strong>en attente de validation</strong> par un
              administrateur.
            </p>
            <p className="text-xs text-white/60 mb-5">
              Après validation, vous pourrez définir votre mot de passe via « Mot de passe oublié » sur cet écran, puis
              vous connecter.
            </p>
            <Button type="button" className="w-full" onClick={onClose}>
              Fermer
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-white">Devenir utilisateur</h3>
              <p className="text-sm text-white/65">
                Renseignez vos informations. Votre demande sera validée par un administrateur.
              </p>
            </div>

            {error ? (
              <div className="mb-4 bg-red-500/15 border border-red-500/25 text-red-50 px-4 py-3 rounded-xl text-sm">
                <i className="fas fa-exclamation-circle mr-1" /> {error}
              </div>
            ) : null}

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ar-prenom" className={labelClass}>
                    Prénom <span className="text-red-300">*</span>
                  </label>
                  <Input
                    id="ar-prenom"
                    value={prenom}
                    onChange={(e) => setPrenom(e.target.value)}
                    className={inputClass}
                    placeholder="Awa"
                    autoComplete="given-name"
                  />
                </div>
                <div>
                  <label htmlFor="ar-nom" className={labelClass}>
                    Nom <span className="text-red-300">*</span>
                  </label>
                  <Input
                    id="ar-nom"
                    value={nom}
                    onChange={(e) => setNom(e.target.value)}
                    className={inputClass}
                    placeholder="Diop"
                    autoComplete="family-name"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="ar-email" className={labelClass}>
                  Adresse e-mail <span className="text-red-300">*</span>
                </label>
                <Input
                  id="ar-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  placeholder="prenom.nom@exemple.com"
                  autoComplete="email"
                />
              </div>

              <div>
                <label htmlFor="ar-phone" className={labelClass}>
                  Téléphone <span className="text-red-300">*</span>
                </label>
                <Input
                  id="ar-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={inputClass}
                  placeholder="+221 77 000 00 00"
                  autoComplete="tel"
                />
              </div>

              <div>
                <label htmlFor="ar-poste" className={labelClass}>
                  Poste / fonction souhaitée <span className="text-red-300">*</span>
                </label>
                <Input
                  id="ar-poste"
                  value={poste}
                  onChange={(e) => setPoste(e.target.value)}
                  className={inputClass}
                  placeholder="Ex. Chargé de projet"
                />
              </div>

              <div>
                <label htmlFor="ar-org" className={labelClass}>
                  Organisation <span className="text-red-300">*</span>
                </label>
                <select
                  id="ar-org"
                  value={organizationId}
                  onChange={(e) => setOrganizationId(e.target.value)}
                  className={selectClass}
                  disabled={organizationsLoading}
                >
                  <option value="">
                    {organizationsLoading ? 'Chargement…' : '— Sélectionner une organisation —'}
                  </option>
                  {organizations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="ar-pilier" className={labelClass}>
                  Pilier <span className="text-red-300">*</span>
                </label>
                <select
                  id="ar-pilier"
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                  className={selectClass}
                  disabled={!pilierEnabled}
                >
                  <option value="">
                    {!organizationId
                      ? '— Sélectionnez d’abord une organisation —'
                      : departmentsLoading
                        ? 'Chargement des piliers…'
                        : departments.length === 0
                          ? 'Aucun pilier disponible'
                          : '— Sélectionner un pilier —'}
                  </option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                {organizationId && !departmentsLoading && departments.length === 0 ? (
                  <p className="mt-1 text-xs text-white/55">
                    Aucun pilier n’est disponible pour cette organisation : votre demande sera transmise sans pilier et un
                    administrateur l’affectera à la validation.
                  </p>
                ) : null}
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <Button type="button" variant="secondary" className="bg-white/90" onClick={onClose} disabled={submitting}>
                  Annuler
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? 'Envoi…' : 'Envoyer la demande'}
                </Button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default AccessRequestModal;
