import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useLocalization } from '../contexts/LocalizationContext';
import { useAuth } from '../contexts/AuthContextSupabase';
import { Contact, RESOURCE_MANAGEMENT_ROLES, DataCollection, Language, Translation } from '../types';
import * as dataCollectionService from '../services/dataCollectionService';
import * as crmActivityService from '../services/crmActivityService';
import { CRM_INTERACTIONS_CHANGED_EVENT } from '../services/contactInteractionService';
import OrganizationService from '../services/organizationService';
import { draftSalesEmail } from '../services/geminiService';
import ConfirmationModal from './common/ConfirmationModal';
import ExtensibleSelect from './common/ExtensibleSelect';
import * as referentialsService from '../services/referentialsService';
import {
    NAV_SESSION_CRM_FILTER_SOURCE_COLLECTION_ID,
    NAV_SESSION_COLLECTE_PRESET_COLLECTION_ID,
    NAV_SESSION_CRM_OPEN_COLLECTE_TAB,
} from '../contexts/AppNavigationContext';
import CollecteModule from './CollecteModule';
import CrmWebhookSettingsCard from './CrmWebhookSettingsCard';
import CRMContactDetailPage from './CRMContactDetailPage';
import ModuleRichHub from './common/ModuleRichHub';

const statusStyles: Record<Contact['status'], string> = {
    Lead: 'bg-blue-100 text-blue-800',
    Contacted: 'bg-yellow-100 text-yellow-800',
    Unreachable: 'bg-orange-100 text-orange-900',
    CallbackExpected: 'bg-indigo-100 text-indigo-900',
    Prospect: 'bg-purple-100 text-purple-800',
    Customer: 'bg-green-100 text-green-800',
};

function statusTranslationKey(status: Contact['status']): keyof Translation {
    if (status === 'CallbackExpected') return 'callback_expected';
    return status.toLowerCase() as keyof Translation;
}

const ContactFormModal: React.FC<{
    contact: Contact | null;
    onClose: () => void;
    onSave: (contact: Contact | Omit<Contact, 'id'>) => void;
    t: (key: keyof Translation) => string;
    language: Language;
}> = ({ contact, onClose, onSave, t, language }) => {
    const isEditMode = contact !== null;
    const [organizationId, setOrganizationId] = useState<string | null>(null);
    const [categoryId, setCategoryId] = useState(contact?.categoryId ?? '');
    const [formData, setFormData] = useState({
        name: contact?.name || '',
        company: contact?.company || '',
        status: contact?.status || 'Lead',
        avatar: contact?.avatar || `https://picsum.photos/seed/crm-${contact ? String(contact.id) : 'new'}/100/100`,
        officePhone: contact?.officePhone || '',
        mobilePhone: contact?.mobilePhone || '',
        whatsappNumber: contact?.whatsappNumber || '',
        workEmail: contact?.workEmail || '',
        personalEmail: contact?.personalEmail || ''
    });

    useEffect(() => {
        OrganizationService.getCurrentUserOrganizationId().then(setOrganizationId).catch(() => setOrganizationId(null));
    }, []);

    useEffect(() => {
        setCategoryId(contact?.categoryId ?? '');
        setFormData({
            name: contact?.name || '',
            company: contact?.company || '',
            status: contact?.status || 'Lead',
            avatar:
                contact?.avatar ||
                `https://picsum.photos/seed/crm-${contact ? String(contact.id) : 'new'}/100/100`,
            officePhone: contact?.officePhone || '',
            mobilePhone: contact?.mobilePhone || '',
            whatsappNumber: contact?.whatsappNumber || '',
            workEmail: contact?.workEmail || '',
            personalEmail: contact?.personalEmail || '',
        });
    }, [contact]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setFormData(prev => ({...prev, [e.target.name]: e.target.value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const dataToSave = {
            ...(isEditMode && { id: contact.id }),
            ...formData,
            categoryId: categoryId || undefined
        };
        onSave(dataToSave as Contact);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-[60] p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg">
                <form onSubmit={handleSubmit}>
                    <div className="p-6 border-b"><h2 className="text-xl font-bold">{isEditMode ? t('edit_contact') : t('create_contact')}</h2></div>
                    <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">{t('contact_name')}</label>
                                <input name="name" value={formData.name} onChange={handleChange} className="mt-1 block w-full p-2 border border-gray-300 rounded-md" required/>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">{t('contact_company')}</label>
                                <input name="company" value={formData.company} onChange={handleChange} className="mt-1 block w-full p-2 border border-gray-300 rounded-md" required/>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">{t('work_email')}</label>
                                <input type="email" name="workEmail" value={formData.workEmail} onChange={handleChange} className="mt-1 block w-full p-2 border border-gray-300 rounded-md"/>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">{t('personal_email')}</label>
                                <input type="email" name="personalEmail" value={formData.personalEmail} onChange={handleChange} className="mt-1 block w-full p-2 border border-gray-300 rounded-md"/>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">{t('office_phone')}</label>
                                <input type="tel" name="officePhone" value={formData.officePhone} onChange={handleChange} className="mt-1 block w-full p-2 border border-gray-300 rounded-md"/>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">{t('mobile_phone')}</label>
                                <input type="tel" name="mobilePhone" value={formData.mobilePhone} onChange={handleChange} className="mt-1 block w-full p-2 border border-gray-300 rounded-md"/>
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">{t('whatsapp_number')}</label>
                            <input type="tel" name="whatsappNumber" value={formData.whatsappNumber} onChange={handleChange} className="mt-1 block w-full p-2 border border-gray-300 rounded-md"/>
                        </div>
                        <ExtensibleSelect
                            entityType="contact_category"
                            value={categoryId}
                            onChange={(id) => setCategoryId(id)}
                            organizationId={organizationId}
                            language={language}
                            canCreate={true}
                            canEdit={true}
                            label={t('contact_category') || 'Catégorie'}
                            placeholder={t('choose_category') || '— Choisir —'}
                        />
                        <div>
                            <label className="block text-sm font-medium text-gray-700">{t('contact_status')}</label>
                            <select name="status" value={formData.status} onChange={handleChange} className="mt-1 block w-full p-2 border border-gray-300 rounded-md">
                                <option value="Lead">{t('lead')}</option>
                                <option value="Contacted">{t('contacted')}</option>
                                <option value="Unreachable">{t('unreachable')}</option>
                                <option value="CallbackExpected">{t('callback_expected')}</option>
                                <option value="Prospect">{t('prospect')}</option>
                                <option value="Customer">{t('customer')}</option>
                            </select>
                        </div>
                    </div>
                    <div className="p-4 bg-gray-50 border-t flex justify-end space-x-2">
                        <button type="button" onClick={onClose} className="bg-gray-200 text-gray-800 px-4 py-2 rounded-lg font-semibold hover:bg-gray-300">{t('cancel')}</button>
                        <button type="submit" className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-emerald-700">{t('save')}</button>
                    </div>
                </form>
            </div>
        </div>
    );
};


const MAILTO_BODY_MAX = 1700;

const EmailDraftModal: React.FC<{
    contact: Contact;
    emailBody: string;
    isLoading: boolean;
    hadAiError: boolean;
    onClose: () => void;
    t: (key: keyof Translation) => string;
}> = ({ contact, emailBody, isLoading, hadAiError, onClose, t }) => {
    const [body, setBody] = useState(emailBody);
    const [copyHint, setCopyHint] = useState<string | null>(null);

    useEffect(() => {
        setBody(emailBody);
    }, [emailBody]);

    const subjectLine = `${t('crm_draft_email_title')} — ${contact.name}`;
    const toAddress = (contact.workEmail || contact.personalEmail || '').trim();
    const mailtoHref = useMemo(() => {
        if (!toAddress) return '';
        return `mailto:${toAddress}?subject=${encodeURIComponent(subjectLine)}&body=${encodeURIComponent(body.slice(0, MAILTO_BODY_MAX))}`;
    }, [toAddress, subjectLine, body]);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(body);
            setCopyHint(t('crm_email_copy_ok'));
            window.setTimeout(() => setCopyHint(null), 2500);
        } catch {
            setCopyHint(t('crm_email_copy_fail'));
            window.setTimeout(() => setCopyHint(null), 3500);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl">
                <div className="p-6 border-b">
                    <h2 className="text-xl font-bold text-slate-900">
                        {t('crm_draft_email_title')} — {contact.name}
                    </h2>
                    {hadAiError && !isLoading && (
                        <p className="mt-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                            {t('crm_draft_ai_error')}
                        </p>
                    )}
                </div>
                <div className="p-6 max-h-[60vh] overflow-y-auto">
                    {isLoading ? (
                        <div className="flex justify-center items-center min-h-[200px]">
                            <i className="fas fa-spinner fa-spin text-3xl text-emerald-500"></i>
                        </div>
                    ) : (
                        <textarea
                            className="w-full h-64 p-3 border border-slate-200 rounded-md font-mono text-sm text-slate-900"
                            value={body}
                            onChange={(e) => setBody(e.target.value)}
                            readOnly={false}
                        />
                    )}
                    {copyHint && <p className="mt-2 text-sm text-slate-600">{copyHint}</p>}
                </div>
                <div className="p-4 bg-gray-50 border-t flex flex-wrap justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="bg-gray-200 text-gray-800 px-4 py-2 rounded-lg font-semibold hover:bg-gray-300"
                    >
                        {t('crm_email_close')}
                    </button>
                    <button
                        type="button"
                        disabled={isLoading}
                        onClick={handleCopy}
                        className="bg-slate-700 text-white px-4 py-2 rounded-lg font-semibold hover:bg-slate-800 disabled:opacity-50"
                    >
                        {t('crm_email_copy')}
                    </button>
                    <a
                        href={mailtoHref || undefined}
                        onClick={(e) => {
                            if (!mailtoHref) e.preventDefault();
                        }}
                        className={`inline-flex items-center px-4 py-2 rounded-lg font-semibold ${
                            mailtoHref
                                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                : 'bg-slate-300 text-slate-500 cursor-not-allowed pointer-events-none'
                        }`}
                    >
                        {t('crm_email_open_mail')}
                    </a>
                </div>
            </div>
        </div>
    );
};

interface CRMProps {
    contacts: Contact[];
    onAddContact: (contact: Omit<Contact, 'id'>) => Promise<{ contact: Contact; persisted: boolean } | null>;
    onUpdateContact: (contact: Contact) => void | Promise<void>;
    onDeleteContact: (contactId: string | number) => void | Promise<void>;
    setView?: (view: string) => void;
    /** Recharge les contacts depuis Supabase (ex. après sync Collecte). */
    onRefreshContacts?: () => Promise<void>;
    isLoading?: boolean;
    loadingOperation?: string | null;
}

const CRM: React.FC<CRMProps> = ({
    contacts,
    onAddContact,
    onUpdateContact,
    onDeleteContact,
    setView,
    onRefreshContacts,
    isLoading: _isLoading,
    loadingOperation: _loadingOperation,
}) => {
    const { t, language } = useLocalization();
    const { user } = useAuth();
    const [contactSubView, setContactSubView] = useState<'list' | 'pipeline' | 'activities' | 'collecte'>('list');
    const [showCollecteEnrichModal, setShowCollecteEnrichModal] = useState(false);
    const [collecteEnrichCandidates, setCollecteEnrichCandidates] = useState<DataCollection[]>([]);
    const [collecteOrgId, setCollecteOrgId] = useState<string | null>(null);
    const [orgOptions, setOrgOptions] = useState<Array<{ id: string; name: string }>>([]);
    const [orgFilter, setOrgFilter] = useState<string>('__current__');
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [categoryFilter, setCategoryFilter] = useState<string>('');
    const [collecteCampaignFilter, setCollecteCampaignFilter] = useState<string>('');
    const [hideCollectePlaceholders, setHideCollectePlaceholders] = useState(true);
    const [categoryOptions, setCategoryOptions] = useState<referentialsService.ReferentialValue[]>([]);
    const [interactions, setInteractions] = useState<crmActivityService.CrmInteraction[]>([]);
    
    const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
    const [emailBody, setEmailBody] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [emailDraftHadAiError, setEmailDraftHadAiError] = useState(false);
    const [permissionMessage, setPermissionMessage] = useState<string | null>(null);

    const [isFormModalOpen, setFormModalOpen] = useState(false);
    const [editingContact, setEditingContact] = useState<Contact|null>(null);
    const [deletingContactId, setDeletingContactId] = useState<number | string | null>(null);
    const [detailContactId, setDetailContactId] = useState<string | number | null>(null);

    const openCollecteWorkspaceInCrm = useCallback(() => {
        setContactSubView('collecte');
        setView?.('crm_sales');
    }, [setView]);

    // `canManage` : rôles « gestion des ressources » (paramétrage / webhooks). Les actions sur un contact donné passent par `canManageContact` (créateur / propriétaire ou même liste de rôles).
    const canManage = useMemo(() => {
        if (!user) return false;
        return RESOURCE_MANAGEMENT_ROLES.includes(user.role);
    }, [user]);

    const canManageContact = useCallback(
        (contact: Contact | null) => {
            if (!user || !contact) return false;
            const ownerId = contact.createdById ? contact.createdById.toString() : null;
            const matchesOwner =
                !!ownerId &&
                (ownerId === String(user.profileId) ||
                    ownerId === String(user.id));
            return Boolean(matchesOwner || RESOURCE_MANAGEMENT_ROLES.includes(user.role));
        },
        [user]
    );
    
    const pipelineStatuses: Contact['status'][] = [
        'Lead',
        'Contacted',
        'Unreachable',
        'CallbackExpected',
        'Prospect',
        'Customer',
    ];

    const setContactStatusQuick = useCallback(
        (contact: Contact, status: Contact['status']) => {
            if (!canManageContact(contact)) return;
            void onUpdateContact({ ...contact, status });
        },
        [canManageContact, onUpdateContact],
    );

    useEffect(() => {
        let cancelled = false;
        OrganizationService.getCurrentUserOrganizationId().then((orgId) => {
            if (cancelled || !orgId) return;
            return referentialsService.listValues('contact_category', orgId);
        }).then((list) => {
            if (list && !cancelled) setCategoryOptions(list);
        }).catch(() => {});
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        OrganizationService.getCurrentUserOrganizationId().then(setCollecteOrgId).catch(() => setCollecteOrgId(null));
    }, []);

    useEffect(() => {
        let cancelled = false;
        crmActivityService.listCrmInteractions({ limit: 40 }).then((rows) => {
            if (!cancelled) setInteractions(rows);
        });
        return () => {
            cancelled = true;
        };
    }, [contacts.length]);

    useEffect(() => {
        const reload = () => {
            void crmActivityService.listCrmInteractions({ limit: 40 }).then((rows) => setInteractions(rows));
        };
        if (typeof window === 'undefined') return undefined;
        window.addEventListener(CRM_INTERACTIONS_CHANGED_EVENT, reload);
        return () => window.removeEventListener(CRM_INTERACTIONS_CHANGED_EVENT, reload);
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const currentOrgId = await OrganizationService.getCurrentUserOrganizationId();
                if (cancelled) return;
                if (user?.role === 'super_administrator') {
                    const all = await OrganizationService.getAllOrganizations();
                    if (cancelled) return;
                    setOrgOptions(all.map((o) => ({ id: String(o.id), name: o.name })));
                    if (currentOrgId) setOrgFilter(currentOrgId);
                } else if (currentOrgId) {
                    setOrgOptions([{ id: String(currentOrgId), name: 'Organisation courante' }]);
                    setOrgFilter(String(currentOrgId));
                }
            } catch {
                /* ignore */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [user?.role]);

    useEffect(() => {
        try {
            const raw = sessionStorage.getItem(NAV_SESSION_CRM_FILTER_SOURCE_COLLECTION_ID);
            if (raw) {
                sessionStorage.removeItem(NAV_SESSION_CRM_FILTER_SOURCE_COLLECTION_ID);
                setCollecteCampaignFilter(raw);
            }
        } catch {
            /* ignore */
        }
    }, []);

    useEffect(() => {
        try {
            const raw = sessionStorage.getItem(NAV_SESSION_CRM_OPEN_COLLECTE_TAB);
            if (raw === '1') {
                sessionStorage.removeItem(NAV_SESSION_CRM_OPEN_COLLECTE_TAB);
                setContactSubView('collecte');
            }
        } catch {
            /* ignore */
        }
    }, []);

    useEffect(() => {
        if (!permissionMessage) return;
        const tmr = window.setTimeout(() => setPermissionMessage(null), 5000);
        return () => window.clearTimeout(tmr);
    }, [permissionMessage]);

    const collecteNameById = useMemo(() => {
        const m = new Map<string, string>();
        dataCollectionService.listDataCollections(collecteOrgId).forEach((c) => {
            m.set(String(c.id), c.name);
        });
        return m;
    }, [collecteOrgId]);

    const collecteCampaignOptions = useMemo(() => {
        const ids = new Set<string>();
        contacts.forEach((c) => {
            if (c.sourceCollectionId) ids.add(String(c.sourceCollectionId));
        });
        dataCollectionService.listDataCollections(collecteOrgId).forEach((dc) => ids.add(dc.id));
        return Array.from(ids).sort();
    }, [contacts, collecteOrgId]);

    const openCollecteEnrichModal = useCallback(() => {
        const list = dataCollectionService.listDataCollections(collecteOrgId).filter((c) => !c.linkedToCrm);
        setCollecteEnrichCandidates(list);
        setShowCollecteEnrichModal(true);
    }, [collecteOrgId]);

    const applyCollecteToCrm = useCallback(
        async (c: DataCollection) => {
            const safeId = String(c.id).replace(/[^a-zA-Z0-9-]/g, '');
            try {
                const result = await onAddContact({
                    name: c.name,
                    company: 'Collecte de données',
                    status: 'Lead',
                    workEmail: `collecte.${safeId || 'item'}@placeholder.local`,
                    personalEmail: '',
                    avatar: `https://picsum.photos/seed/collecte-${encodeURIComponent(String(c.id))}/100/100`,
                    source: 'collecte_campaign_placeholder',
                    sourceCollectionId: c.id,
                });
                if (result?.persisted) {
                    dataCollectionService.markDataCollectionLinkedToCrm(c.id);
                    setShowCollecteEnrichModal(false);
                } else {
                    setPermissionMessage(t('crm_persist_failed'));
                }
            } catch {
                setPermissionMessage(t('crm_persist_failed'));
            }
        },
        [onAddContact, t]
    );

    // Métriques calculées
    const metrics = useMemo(() => {
        const totalContacts = contacts.length;
        const leads = contacts.filter(c => c.status === 'Lead').length;
        const prospects = contacts.filter(c => c.status === 'Prospect').length;
        const customers = contacts.filter(c => c.status === 'Customer').length;
        const conversionRate = totalContacts > 0 ? ((customers / totalContacts) * 100).toFixed(1) : '0';

        return {
            totalContacts,
            leads,
            prospects,
            customers,
            conversionRate
        };
    }, [contacts]);

    // Filtrage des contacts
    const detailContact = useMemo(
        () =>
            detailContactId == null
                ? null
                : contacts.find((c) => String(c.id) === String(detailContactId)) ?? null,
        [contacts, detailContactId],
    );

    /** Libellé catégorie depuis le référentiel si l’API n’a pas renvoyé `categoryName` (évite l’affichage brut d’un UUID). */
    const detailContactEnriched = useMemo(() => {
        if (!detailContact) return null;
        const cid = detailContact.categoryId;
        let categoryName = detailContact.categoryName ?? null;
        if (!categoryName && cid) {
            const opt = categoryOptions.find((o) => String(o.id) === String(cid));
            if (opt?.name) categoryName = opt.name;
        }
        return { ...detailContact, categoryName: categoryName ?? undefined };
    }, [detailContact, categoryOptions]);

    useEffect(() => {
        if (contactSubView === 'collecte') setDetailContactId(null);
    }, [contactSubView]);

    const filteredContacts = useMemo(() => {
        let filtered = contacts;

        if (orgFilter && orgFilter !== '__all__' && orgFilter !== '__current__') {
            filtered = filtered.filter((c) => String(c.organizationId || '') === String(orgFilter));
        }
        
        if (searchTerm) {
            filtered = filtered.filter(contact =>
                contact.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                contact.company.toLowerCase().includes(searchTerm.toLowerCase()) ||
                contact.workEmail?.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }
        
        if (statusFilter !== 'all') {
            filtered = filtered.filter(contact => contact.status === statusFilter);
        }
        if (categoryFilter) {
            filtered = filtered.filter(contact => contact.categoryId === categoryFilter);
        }
        if (hideCollectePlaceholders) {
            filtered = filtered.filter(
                (c) => !String(c.workEmail || '').toLowerCase().includes('@placeholder.local')
            );
        }
        if (collecteCampaignFilter) {
            filtered = filtered.filter((c) => String(c.sourceCollectionId || '') === collecteCampaignFilter);
        }
        return filtered;
    }, [
        contacts,
        orgFilter,
        searchTerm,
        statusFilter,
        categoryFilter,
        hideCollectePlaceholders,
        collecteCampaignFilter,
    ]);

    const handleDraftEmail = async (contact: Contact) => {
        if (!user) return;
        setSelectedContact(contact);
        setIsLoading(true);
        const body = await draftSalesEmail(contact, {
          authorName: user.fullName ?? user.name,
          authorEmail: user.email,
          authorRole: user.role,
        } satisfies Record<string, unknown>);
        setEmailBody(body);
        setIsLoading(false);
    };

    const handleCloseModal = () => {
        setSelectedContact(null);
        setEmailBody('');
    };
    
    const handleSaveContact = (contactData: Contact | Omit<Contact, 'id'>) => {
        if ('id' in contactData) {
            const existing = contactData as Contact;
            if (!canManageContact(existing)) {
                setPermissionMessage(t('crm_permission_denied'));
                return;
            }
            onUpdateContact(existing);
        } else {
            if (!canManage) {
                setPermissionMessage(t('crm_permission_denied'));
                return;
            }
            void onAddContact(contactData);
        }
        setFormModalOpen(false);
        setEditingContact(null);
    };

    const handleEdit = (contact: Contact) => {
        if (!canManageContact(contact)) {
            setPermissionMessage(t('crm_permission_denied'));
            return;
        }
        setEditingContact(contact);
        setFormModalOpen(true);
    };
    
    const handleDelete = async (contactId: number | string) => {
        const target = contacts.find(c => String(c.id) === String(contactId)) || null;
        if (!canManageContact(target)) {
            setPermissionMessage(t('crm_permission_denied'));
            setDeletingContactId(null);
            return;
        }
        await onDeleteContact(contactId);
        setDeletingContactId(null);
        if (detailContactId != null && String(detailContactId) === String(contactId)) {
            setDetailContactId(null);
        }
    };
    
    // Drag and Drop handlers
    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, contactId: number | string) => {
        const contact = filteredContacts.find(c => String(c.id) === String(contactId)) || null;
        if (!canManageContact(contact)) {
            e.preventDefault();
            return;
        }
        e.dataTransfer.setData("contactId", contactId.toString());
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>, newStatus: Contact['status']) => {
        e.preventDefault();
        const contactId = e.dataTransfer.getData("contactId");
        const contactToMove = filteredContacts.find(c => String(c.id) === contactId);
        if (contactToMove && contactToMove.status !== newStatus) {
            if (!canManageContact(contactToMove)) {
                setPermissionMessage(t('crm_permission_denied'));
                e.currentTarget.classList.remove('bg-emerald-100');
                return;
            }
            onUpdateContact({ ...contactToMove, status: newStatus });
        }
        e.currentTarget.classList.remove('bg-emerald-100');
    };
    
    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.currentTarget.classList.add('bg-emerald-100');
    };
    
    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        e.currentTarget.classList.remove('bg-emerald-100');
    };


    return (
        <>
        {detailContactEnriched ? (
            <CRMContactDetailPage
                contact={detailContactEnriched}
                onBack={() => setDetailContactId(null)}
                onRequestEdit={(c) => {
                    setDetailContactId(null);
                    handleEdit(c);
                }}
                onRequestDelete={(id) => setDeletingContactId(id)}
                onDraftEmail={(c) => {
                    setDetailContactId(null);
                    void handleDraftEmail(c);
                }}
                onGoToCollecteCampaign={(collectionId) => {
                    try {
                        sessionStorage.setItem(NAV_SESSION_COLLECTE_PRESET_COLLECTION_ID, collectionId);
                    } catch {
                        /* ignore */
                    }
                    setDetailContactId(null);
                    setContactSubView('collecte');
                }}
                canEdit={canManageContact(detailContactEnriched)}
                onUpdateContact={(c) => void onUpdateContact(c)}
            />
        ) : detailContactId != null ? (
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center space-y-4 text-slate-900">
                <p className="text-slate-600">{t('crm_contact_detail_not_found')}</p>
                <button
                    type="button"
                    onClick={() => setDetailContactId(null)}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
                >
                    {t('crm_contact_detail_back')}
                </button>
            </div>
        ) : (
        <div className="p-6 space-y-6 text-gray-900">
            <header className="rounded-2xl bg-white border border-gray-100 shadow-sm">
                <div className="px-5 py-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex items-start gap-3 min-w-0">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white text-xs">
                                <i className="fas fa-users" aria-hidden />
                            </span>
                            <div className="min-w-0">
                                <h1 className="text-lg sm:text-xl font-semibold text-slate-900 tracking-tight">{t('crm_title')}</h1>
                                <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{t('crm_subtitle')}</p>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                            {user?.role === 'super_administrator' && (
                                <div className="inline-flex items-center gap-2 px-2 py-1.5 rounded-lg border border-slate-200 bg-white">
                                    <i className="fas fa-building text-slate-500 text-[11px]" aria-hidden />
                                    <select
                                        value={orgFilter}
                                        onChange={(e) => setOrgFilter(e.target.value)}
                                        className="text-xs font-medium text-slate-700 bg-transparent focus:outline-none"
                                    >
                                        <option value="__all__">{language === Language.FR ? 'Toutes' : 'All'}</option>
                                        {orgOptions.map((o) => (
                                            <option key={o.id} value={o.id}>
                                                {o.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            {canManage && (
                                <button
                                    type="button"
                                    onClick={openCollecteEnrichModal}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-medium hover:bg-slate-50"
                                >
                                    <i className="fas fa-database text-[11px]" />
                                    {t('crm_enrich_from_collecte')}
                                </button>
                            )}
                            {canManage && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        try {
                                            // Si un filtre collecte est actif, on le réutilise comme présélection.
                                            const preset = sessionStorage.getItem(NAV_SESSION_CRM_FILTER_SOURCE_COLLECTION_ID);
                                            if (preset) sessionStorage.setItem(NAV_SESSION_COLLECTE_PRESET_COLLECTION_ID, preset);
                                        } catch {
                                            /* ignore */
                                        }
                                        setContactSubView('collecte');
                                    }}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 text-xs font-semibold hover:bg-emerald-100"
                                >
                                    <i className="fas fa-clipboard-check text-[11px]" />
                                    {t('crm_tab_collecte')}
                                </button>
                            )}
                            {canManage && (
                                <button
                                    type="button"
                                    onClick={() => setFormModalOpen(true)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
                                >
                                    <i className="fas fa-plus text-[11px]" />
                                    {t('create_contact')}
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                        <div className="bg-slate-100/90 rounded-xl border border-slate-200/80 p-0.5 inline-flex flex-wrap gap-0.5">
                            <button
                                type="button"
                                onClick={() => setContactSubView('list')}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                    contactSubView === 'list' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-white/80'
                                }`}
                            >
                                <i className="fas fa-list text-[10px]" />
                                {t('list_view')}
                            </button>
                            <button
                                type="button"
                                onClick={() => setContactSubView('pipeline')}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                    contactSubView === 'pipeline' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-white/80'
                                }`}
                            >
                                <i className="fas fa-columns text-[10px]" />
                                {t('pipeline_view')}
                            </button>
                            <button
                                type="button"
                                onClick={() => setContactSubView('activities')}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                    contactSubView === 'activities' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-white/80'
                                }`}
                            >
                                <i className="fas fa-comments text-[10px]" />
                                {language === Language.FR ? 'Interactions' : 'Interactions'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setContactSubView('collecte')}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                    contactSubView === 'collecte'
                                        ? 'bg-emerald-700 text-white shadow-sm'
                                        : 'text-slate-600 hover:bg-white/80'
                                }`}
                            >
                                <i className="fas fa-clipboard-check text-[10px]" />
                                {t('crm_tab_collecte')}
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            <div className="px-4 sm:px-6 lg:px-8 pb-4">
              <ModuleRichHub
                isFr={language === Language.FR}
                sections={[
                  {
                    key: 'crm-scope',
                    titleFr: 'Couverture fonctionnelle CRM',
                    titleEn: 'CRM functional coverage',
                    icon: 'fas fa-layer-group',
                    bulletsFr: [
                      'Les indicateurs détaillés (contacts, leads, pipeline) sont affichés juste ci-dessous dans cette même vue.',
                      'Vues liste, pipeline Kanban, interactions et onglet Collecte intégré.',
                      'Fiche contact riche : historique, emails, rattachements campagne.',
                    ],
                    bulletsEn: [
                      'Detailed KPIs (contacts, leads, pipeline) are shown just below in this view.',
                      'List view, Kanban pipeline, interactions and embedded Collecte tab.',
                      'Rich contact record: history, emails, campaign links.',
                    ],
                  },
                ]}
              />
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            {permissionMessage && (
                <div
                    className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex items-start justify-between gap-3"
                    role="alert"
                >
                    <span>{permissionMessage}</span>
                    <button
                        type="button"
                        onClick={() => setPermissionMessage(null)}
                        className="shrink-0 text-amber-800 hover:text-amber-950 font-semibold"
                        aria-label={t('crm_email_close')}
                    >
                        ×
                    </button>
                </div>
            )}

            {contactSubView !== 'collecte' && (
            <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3 mb-4">
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 sm:px-4 sm:py-3">
                    <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">
                        {t('crm_kpi_total_contacts')}
                    </p>
                    <p className="mt-0.5 text-lg sm:text-xl font-semibold text-slate-900 tabular-nums">{metrics.totalContacts}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 sm:px-4 sm:py-3">
                    <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">
                        {t('crm_kpi_leads')}
                    </p>
                    <p className="mt-0.5 text-lg sm:text-xl font-semibold text-slate-900 tabular-nums">{metrics.leads}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 sm:px-4 sm:py-3">
                    <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">
                        {t('crm_kpi_prospects')}
                    </p>
                    <p className="mt-0.5 text-lg sm:text-xl font-semibold text-slate-900 tabular-nums">{metrics.prospects}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 sm:px-4 sm:py-3">
                    <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">
                        {t('crm_kpi_customers')}
                    </p>
                    <p className="mt-0.5 text-lg sm:text-xl font-semibold text-slate-900 tabular-nums">{metrics.customers}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 sm:px-4 sm:py-3 col-span-2 sm:col-span-1">
                    <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">
                        {t('crm_kpi_conversion')}
                    </p>
                    <p className="mt-0.5 text-lg sm:text-xl font-semibold text-slate-900 tabular-nums">{metrics.conversionRate}%</p>
                </div>
            </div>

            {canManage && (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-2 text-[11px] text-amber-950 leading-snug">
                    <i className="fas fa-route mr-1.5 opacity-80" aria-hidden />
                    {t('crm_codification_hint')}
                </div>
            )}

                <div className="bg-white rounded-xl border border-slate-200 p-3 mb-4">
                    <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                        <div className="flex-1 min-w-0">
                            <div className="relative">
                                <i className="fas fa-search absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
                                <input
                                    type="text"
                                    placeholder={t('crm_search_contacts_placeholder')}
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-slate-200 focus:border-slate-300 bg-white"
                                />
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="px-2.5 py-2 border border-slate-200 rounded-lg text-xs sm:text-sm bg-white min-w-[8.5rem]"
                            >
                                <option value="all">Tous les statuts</option>
                                <option value="Lead">Lead</option>
                                <option value="Contacted">Contacté</option>
                                <option value="Unreachable">Non joignable</option>
                                <option value="CallbackExpected">Recontact attendu</option>
                                <option value="Prospect">Prospect</option>
                                <option value="Customer">Client</option>
                            </select>
                            <select
                                value={categoryFilter}
                                onChange={(e) => setCategoryFilter(e.target.value)}
                                className="px-2.5 py-2 border border-slate-200 rounded-lg text-xs sm:text-sm bg-white min-w-[9rem]"
                            >
                                <option value="">Toutes catégories</option>
                                {categoryOptions.map((opt) => (
                                    <option key={opt.id} value={opt.id}>{opt.name}</option>
                                ))}
                            </select>
                            <select
                                value={collecteCampaignFilter}
                                onChange={(e) => setCollecteCampaignFilter(e.target.value)}
                                className="px-2.5 py-2 border border-slate-200 rounded-lg text-xs sm:text-sm bg-white max-w-[12rem]"
                            >
                                <option value="">{t('crm_filter_all_campaigns')}</option>
                                {collecteCampaignOptions.map((id) => (
                                    <option key={id} value={id}>
                                        {collecteNameById.get(id) ?? `${id.slice(0, 8)}…`}
                                    </option>
                                ))}
                            </select>
                            <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    className="rounded border-slate-300 text-slate-900 shrink-0"
                                    checked={hideCollectePlaceholders}
                                    onChange={(e) => setHideCollectePlaceholders(e.target.checked)}
                                />
                                <span className="leading-tight">{t('crm_hide_placeholder_emails')}</span>
                            </label>
                        </div>
                    </div>
                </div>

                {/* Vues */}
            {contactSubView === 'list' && (
                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-slate-600 min-w-[640px]">
                                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                    <tr>
                                        <th scope="col" className="px-3 py-2.5">{t('contact_name')}</th>
                                        <th scope="col" className="px-3 py-2.5">{t('contact_company')}</th>
                                        <th scope="col" className="px-3 py-2.5">{t('contact_status')}</th>
                                        <th scope="col" className="px-3 py-2.5">{t('crm_column_collecte')}</th>
                                        <th scope="col" className="px-3 py-2.5">{t('work_email')}</th>
                                        <th scope="col" className="px-3 py-2.5 text-right">{t('actions')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                    {filteredContacts.map(contact => (
                                        <tr
                                            key={contact.id}
                                            className="bg-white hover:bg-slate-50/80 transition-colors cursor-pointer"
                                            onClick={(e) => {
                                                if ((e.target as HTMLElement).closest('button, a')) return;
                                                setDetailContactId(contact.id);
                                            }}
                                        >
                                        <th scope="row" className="px-3 py-2 font-medium text-slate-900 align-middle">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <img src={contact.avatar || undefined} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0 border border-slate-100" onError={(e) => { e.currentTarget.style.display = 'none'; }}/>
                                                <div className="min-w-0 text-left">
                                                    <div className="font-semibold text-slate-900 truncate text-sm">{contact.name}</div>
                                                    <div className="text-[11px] text-slate-500 truncate">{contact.workEmail || contact.personalEmail || '—'}</div>
                                                </div>
                                            </div>
                                        </th>
                                            <td className="px-3 py-2 align-middle">
                                                <div className="font-medium text-slate-800 text-sm truncate max-w-[10rem] sm:max-w-[14rem]">{contact.company}</div>
                                                {contact.officePhone && (
                                                    <div className="text-[11px] text-slate-500 mt-0.5">
                                                        <i className="fas fa-phone mr-1 opacity-70" />
                                                        {contact.officePhone}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 align-middle">
                                                <span className={`inline-flex px-2 py-0.5 font-medium rounded-md text-[11px] ${statusStyles[contact.status]}`}>
                                                    {t(statusTranslationKey(contact.status))}
                                                </span>
                                                {canManageContact(contact) ? (
                                                    <div className="mt-1.5 flex flex-wrap gap-0.5">
                                                        <button
                                                            type="button"
                                                            className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setContactStatusQuick(contact, 'Contacted');
                                                            }}
                                                        >
                                                            {t('crm_btn_contacted')}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setContactStatusQuick(contact, 'Unreachable');
                                                            }}
                                                        >
                                                            {t('crm_btn_unreachable')}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setContactStatusQuick(contact, 'CallbackExpected');
                                                            }}
                                                        >
                                                            {t('crm_btn_callback')}
                                                        </button>
                                                    </div>
                                                ) : null}
                                            </td>
                                            <td className="px-3 py-2 align-middle">
                                                {contact.sourceCollectionId ? (
                                                    <span className="inline-flex max-w-[9rem] truncate px-2 py-0.5 rounded-md text-[11px] font-medium bg-sky-50 text-sky-900 border border-sky-100">
                                                        {collecteNameById.get(String(contact.sourceCollectionId)) ??
                                                            `${String(contact.sourceCollectionId).slice(0, 8)}…`}
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-400">—</span>
                                                )}
                                            </td>
                                        <td className="px-3 py-2 align-middle">
                                                <div className="text-xs text-slate-600 truncate max-w-[11rem]">
                                                    {contact.workEmail || '—'}
                                                </div>
                                        </td>
                                            <td className="px-3 py-2 text-right align-middle">
                                                <div className="inline-flex items-center justify-end gap-0.5">
                                        <button 
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                void handleDraftEmail(contact);
                                            }} 
                                            className="text-emerald-600 hover:text-emerald-800 p-1.5 hover:bg-emerald-50 rounded-md transition-colors"
                                            title={t('draft_email_with_ai')}
                                        >
                                            <i className="fas fa-magic text-xs" />
                                        </button>
                                             {canManageContact(contact) && (
                                                <>
                                                            <button 
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleEdit(contact);
                                                                }} 
                                                                className="text-blue-600 hover:text-blue-800 p-1.5 hover:bg-blue-50 rounded-md transition-colors"
                                                                title={t('edit')}
                                                            >
                                                                <i className="fas fa-edit text-xs" />
                                                            </button>
                                                            <button 
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setDeletingContactId(contact.id);
                                                                }} 
                                                                className="text-red-600 hover:text-red-800 p-1.5 hover:bg-red-50 rounded-md transition-colors"
                                                                title={t('delete')}
                                                            >
                                                                <i className="fas fa-trash text-xs" />
                                                            </button>
                                                </>
                                            )}
                                                </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                            {filteredContacts.length === 0 && (
                                <div className="text-center py-8 px-4 border-t border-slate-100">
                                    <i className="fas fa-search text-3xl text-slate-200 mb-2" />
                                    <p className="text-slate-600 text-sm font-medium">{language === Language.FR ? 'Aucun contact trouvé' : 'No contacts found'}</p>
                                    <p className="text-slate-400 text-xs mt-1">{language === Language.FR ? 'Modifiez recherche ou filtres.' : 'Try adjusting search or filters.'}</p>
                                </div>
                            )}
                    </div>
                </div>
            )}

            {contactSubView === 'pipeline' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-2">
                    {pipelineStatuses.map(status => (
                        <div 
                            key={status} 
                                className="bg-slate-50/80 rounded-xl p-3 transition-colors border border-slate-200"
                            onDrop={(e) => handleDrop(e, status)}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                        >
                                <div className="flex items-center justify-between mb-2 gap-2">
                                    <h3 className={`font-semibold text-[11px] uppercase tracking-wide px-2 py-0.5 rounded-md ${statusStyles[status]}`}>
                                        {t(statusTranslationKey(status))}
                                    </h3>
                                    <span className="bg-white text-slate-600 text-[11px] font-bold px-1.5 py-0.5 rounded-md border border-slate-200 tabular-nums">
                                        {filteredContacts.filter(c => c.status === status).length}
                                    </span>
                                </div>
                                <div className="space-y-2 min-h-[140px]">
                                {filteredContacts.filter(c => c.status === status).map(contact => (
                                    <div 
                                        key={contact.id} 
                                        role="button"
                                        tabIndex={0}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                setDetailContactId(contact.id);
                                            }
                                        }}
                                        onClick={(e) => {
                                            if ((e.target as HTMLElement).closest('button')) return;
                                            setDetailContactId(contact.id);
                                        }}
                                        draggable={canManageContact(contact)}
                                        onDragStart={(e) => canManageContact(contact) && handleDragStart(e, contact.id)}
                                            className="bg-white p-2.5 rounded-lg border border-slate-100 shadow-sm hover:border-slate-200 cursor-grab active:cursor-grabbing transition-all group"
                                    >
                                            <div className="flex items-start gap-2 mb-1">
                                                <img src={contact.avatar || undefined} alt="" className="w-7 h-7 rounded-md object-cover shrink-0 border border-slate-100" onError={(e) => { e.currentTarget.style.display = 'none'; }}/>
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-semibold text-xs text-slate-900 truncate">{contact.name}</p>
                                        <p className="text-[11px] text-slate-500 truncate">{contact.company}</p>
                                                </div>
                                            </div>
                                            {contact.workEmail && (
                                                <div className="text-[10px] text-slate-400 mb-1.5 truncate">
                                                    <i className="fas fa-envelope mr-0.5 opacity-70" />
                                                    {contact.workEmail}
                                                </div>
                                            )}
                                            <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 gap-1 flex-wrap">
                                                {canManageContact(contact) ? (
                                                <button 
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleEdit(contact);
                                                    }}
                                                    className="text-blue-600 hover:text-blue-800 text-[11px] font-medium"
                                                >
                                                    <i className="fas fa-edit mr-0.5" />
                                                    {language === Language.FR ? 'Éditer' : 'Edit'}
                                                </button>
                                                ) : <span />}
                                            <button 
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    void handleDraftEmail(contact);
                                                }}
                                                className="text-emerald-600 hover:text-emerald-800 text-[11px] font-medium"
                                            >
                                                <i className="fas fa-magic mr-0.5" />
                                                IA
                                            </button>
                                            </div>
                                    </div>
                                ))}
                                    {filteredContacts.filter(c => c.status === status).length === 0 && (
                                        <div className="text-center py-6 text-slate-400 text-xs">
                                            {language === Language.FR ? 'Aucun contact' : 'No contacts'}
                                        </div>
                                    )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {contactSubView === 'activities' && (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100">
                        <h2 className="text-sm font-semibold text-slate-900">
                            {language === Language.FR ? 'Journal des interactions CRM' : 'CRM interaction log'}
                        </h2>
                        <p className="mt-1 text-xs text-slate-500">
                            {language === Language.FR
                                ? 'Historique des notes, appels, emails et événements Studio liés aux contacts.'
                                : 'Notes, calls, emails and Studio events linked to contacts.'}
                        </p>
                    </div>
                    {interactions.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-slate-500">
                            {language === Language.FR ? 'Aucune interaction enregistrée.' : 'No interaction logged.'}
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {interactions.map((interaction) => (
                                <div key={interaction.id} className="px-4 py-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                                            {interaction.channel}
                                        </span>
                                        <span className="text-xs text-slate-400">
                                            {new Date(interaction.createdAt).toLocaleString(language === Language.FR ? 'fr-FR' : 'en-US')}
                                        </span>
                                    </div>
                                    <p className="mt-1 text-sm text-slate-800">{interaction.summary}</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
            </>
            )}

            {contactSubView === 'collecte' && (
                <div className="space-y-4">
                    <CollecteModule embeddedInCrm onAfterCrmBulkSync={() => void onRefreshContacts?.()} />
                    <CrmWebhookSettingsCard organizationId={collecteOrgId} canManage={canManage} t={t} />
                </div>
            )}

            {showCollecteEnrichModal && (
                <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-6">
                        <h3 className="text-lg font-semibold text-slate-900 mb-2">{t('crm_collecte_enrich_modal_title')}</h3>
                        <p className="text-sm text-slate-600 mb-4">{t('crm_collecte_enrich_modal_body')}</p>
                        {collecteEnrichCandidates.length === 0 ? (
                            <p className="text-sm text-slate-500 mb-4">{t('crm_collecte_enrich_modal_empty_hint')}</p>
                        ) : (
                            <ul className="space-y-3 mb-4">
                                {collecteEnrichCandidates.map((c) => (
                                    <li key={c.id} className="rounded-xl border border-slate-200 p-3 space-y-2">
                                        <div className="text-sm font-semibold text-slate-900">{c.name}</div>
                                        <div className="flex flex-wrap gap-2">
                                            {setView && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        try {
                                                            sessionStorage.setItem(
                                                                NAV_SESSION_COLLECTE_PRESET_COLLECTION_ID,
                                                                c.id,
                                                            );
                                                        } catch {
                                                            /* ignore */
                                                        }
                                                        setShowCollecteEnrichModal(false);
                                                        openCollecteWorkspaceInCrm();
                                                    }}
                                                    className="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
                                                >
                                                    {t('crm_import_submissions')}
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => void applyCollecteToCrm(c)}
                                                className="px-3 py-2 rounded-lg border border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-50"
                                            >
                                                {t('crm_collecte_placeholder_note')}
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <div className="flex flex-wrap justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setShowCollecteEnrichModal(false)}
                                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50"
                            >
                                {t('cancel')}
                            </button>
                            {setView && (
                                <button
                                    type="button"
                                    onClick={() => { setShowCollecteEnrichModal(false); openCollecteWorkspaceInCrm(); }}
                                    className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800"
                                >
                                    {t('crm_open_collecte')}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            </div>
        </div>
        )}

            {/* Modals */}
            {selectedContact && (
                <EmailDraftModal
                    contact={selectedContact}
                    onClose={handleCloseModal}
                    emailBody={emailBody}
                    isLoading={isLoading}
                    hadAiError={emailDraftHadAiError}
                    t={t}
                />
            )}
            {isFormModalOpen && (
                <ContactFormModal
                    contact={editingContact}
                    onClose={() => {
                        setFormModalOpen(false);
                        setEditingContact(null);
                    }}
                    onSave={handleSaveContact}
                    t={t}
                    language={language}
                />
            )}
            {deletingContactId !== null && <ConfirmationModal title={t('delete_contact')} message={t('confirm_delete_message')} onConfirm={() => handleDelete(deletingContactId)} onCancel={() => setDeletingContactId(null)} />}

        </>
    );
};

export default CRM;

