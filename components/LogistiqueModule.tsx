import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLocalization } from '../contexts/LocalizationContext';
import { useModulePermissions } from '../hooks/useModulePermissions';
import * as logistiqueService from '../services/logistiqueService';
import type { Equipment, EquipmentCategory, EquipmentRequest, SensitiveDisposalStatus } from '../services/logistiqueService';
import OrganizationService from '../services/organizationService';
import { useAuth } from '../contexts/AuthContextSupabase';
import { NAV_SESSION_MOBILITE_INTENT } from '../contexts/AppNavigationContext';

/** Phase 4.2 – Logistique : équipements, demandes, workflow validation → mise à disposition */
const LogistiqueModule: React.FC = () => {
  const { language, t } = useLocalization();
  const { user } = useAuth();
  const { hasPermission } = useModulePermissions();
  const isFr = language === 'fr';
  const [equipments, setEquipments] = useState<Equipment[]>([]);
  const [categories, setCategories] = useState<EquipmentCategory[]>([]);
  const [requests, setRequests] = useState<EquipmentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEquipForm, setShowEquipForm] = useState(false);
  const [editEquipment, setEditEquipment] = useState<Equipment | null>(null);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const mobiliteIntentConsumedRef = useRef(false);
  const [mobiliteHubBanner, setMobiliteHubBanner] = useState(false);
  const [formEquip, setFormEquip] = useState({
    name: '',
    brand: '',
    model: '',
    equipmentCategoryId: '',
    location: '',
    assetReference: '',
    quantityOnHand: '1',
    reorderThreshold: '0',
    maintenanceNextDue: '',
    maintenanceEstimatedCostCents: '',
    sensitiveAsset: false,
    sensitiveRetentionEnd: '',
    sensitiveDisposalStatus: 'none' as SensitiveDisposalStatus,
  });
  const [formRequest, setFormRequest] = useState({ equipmentId: '', notes: '' });

  const canWrite = useMemo(() => hasPermission('logistique', 'write'), [hasPermission]);
  const isManager = (user?.role && ['super_administrator', 'administrator', 'manager'].includes(user.role)) || canWrite;
  const categoryNameById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  const load = async () => {
    setLoading(true);
    const orgId = await OrganizationService.getCurrentUserOrganizationId();
    const [eqList, reqList] = await Promise.all([
      logistiqueService.listEquipments(orgId),
      logistiqueService.listEquipmentRequests(orgId),
    ]);
    const categoryList = await logistiqueService.listEquipmentCategories(orgId);
    setEquipments(eqList);
    setCategories(categoryList);
    setRequests(reqList);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (mobiliteIntentConsumedRef.current) return;
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(NAV_SESSION_MOBILITE_INTENT);
    } catch {
      return;
    }
    if (raw !== 'external') return;
    mobiliteIntentConsumedRef.current = true;
    try {
      sessionStorage.removeItem(NAV_SESSION_MOBILITE_INTENT);
    } catch {
      /* ignore */
    }
    setShowRequestForm(true);
    setMobiliteHubBanner(true);
    requestAnimationFrame(() => {
      document.getElementById('logistique-equipment-requests')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const emptyEquipForm = () => ({
    name: '',
    brand: '',
    model: '',
    equipmentCategoryId: '',
    location: '',
    assetReference: '',
    quantityOnHand: '1',
    reorderThreshold: '0',
    maintenanceNextDue: '',
    maintenanceEstimatedCostCents: '',
    sensitiveAsset: false,
    sensitiveRetentionEnd: '',
    sensitiveDisposalStatus: 'none' as SensitiveDisposalStatus,
  });

  const resetEquipForm = () => {
    setEditEquipment(null);
    setFormEquip(emptyEquipForm());
    setShowEquipForm(false);
  };

  const openNewEquipmentForm = () => {
    setEditEquipment(null);
    setFormEquip(emptyEquipForm());
    setShowEquipForm(true);
  };

  const openEditEquipment = (eq: Equipment) => {
    setEditEquipment(eq);
    setFormEquip({
      name: eq.name,
      brand: eq.brand || '',
      model: eq.model || '',
      equipmentCategoryId: eq.equipmentCategoryId || '',
      location: eq.location || '',
      assetReference: eq.assetReference || '',
      quantityOnHand: String(eq.quantityOnHand ?? 1),
      reorderThreshold: String(eq.reorderThreshold ?? 0),
      maintenanceNextDue: eq.maintenanceNextDue?.slice(0, 10) || '',
      maintenanceEstimatedCostCents: eq.maintenanceEstimatedCostCents != null ? String(eq.maintenanceEstimatedCostCents) : '',
      sensitiveAsset: !!eq.sensitiveAsset,
      sensitiveRetentionEnd: eq.sensitiveRetentionEnd?.slice(0, 10) || '',
      sensitiveDisposalStatus: eq.sensitiveDisposalStatus || 'none',
    });
    setShowEquipForm(true);
  };

  const handleSaveEquipment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formEquip.name.trim()) return;
    if (editEquipment) {
      const ok = await logistiqueService.updateEquipment(editEquipment.id, {
        name: formEquip.name,
        brand: formEquip.brand,
        model: formEquip.model,
        equipmentCategoryId: formEquip.equipmentCategoryId || undefined,
        location: formEquip.location,
        assetReference: formEquip.assetReference || undefined,
        quantityOnHand: parseInt(formEquip.quantityOnHand, 10) || 0,
        reorderThreshold: parseInt(formEquip.reorderThreshold, 10) || 0,
        maintenanceNextDue: formEquip.maintenanceNextDue || undefined,
        maintenanceEstimatedCostCents: formEquip.maintenanceEstimatedCostCents
          ? parseInt(formEquip.maintenanceEstimatedCostCents, 10)
          : undefined,
        sensitiveAsset: formEquip.sensitiveAsset,
        sensitiveRetentionEnd: formEquip.sensitiveRetentionEnd || undefined,
        sensitiveDisposalStatus: formEquip.sensitiveDisposalStatus,
      });
      if (ok) {
        await load();
        resetEquipForm();
      }
      return;
    }
    const created = await logistiqueService.createEquipment({
      name: formEquip.name,
      brand: formEquip.brand,
      model: formEquip.model,
      equipmentCategoryId: formEquip.equipmentCategoryId || undefined,
      location: formEquip.location,
      assetReference: formEquip.assetReference || undefined,
      quantityOnHand: parseInt(formEquip.quantityOnHand, 10) || 1,
      reorderThreshold: parseInt(formEquip.reorderThreshold, 10) || 0,
      maintenanceNextDue: formEquip.maintenanceNextDue || undefined,
      maintenanceEstimatedCostCents: formEquip.maintenanceEstimatedCostCents
        ? parseInt(formEquip.maintenanceEstimatedCostCents, 10)
        : undefined,
      sensitiveAsset: formEquip.sensitiveAsset,
      sensitiveRetentionEnd: formEquip.sensitiveRetentionEnd || undefined,
      sensitiveDisposalStatus: formEquip.sensitiveDisposalStatus,
    });
    if (created) {
      setEquipments((prev) => [created, ...prev]);
      resetEquipForm();
    }
  };

  const handleArchiveEquipment = async (eq: Equipment) => {
    if (!confirm(isFr ? `Archiver « ${eq.name} » ? Il disparaîtra de la liste.` : `Archive "${eq.name}"? It will be hidden from the list.`)) return;
    const ok = await logistiqueService.archiveEquipment(eq.id);
    if (ok) await load();
  };

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formRequest.equipmentId) return;
    const created = await logistiqueService.createEquipmentRequest({
      equipmentId: formRequest.equipmentId,
      notes: formRequest.notes || undefined,
    });
    if (created) {
      setRequests((prev) => [created, ...prev]);
      setShowRequestForm(false);
      setFormRequest({ equipmentId: '', notes: '' });
    }
  };

  const handleUpdateRequestStatus = async (id: string, status: 'validated' | 'allocated' | 'returned' | 'rejected') => {
    const ok = await logistiqueService.updateEquipmentRequestStatus(id, status);
    if (ok) load();
  };

  const statusLabel = (s: string) =>
    s === 'requested' ? (isFr ? 'Demandé' : 'Requested') :
    s === 'validated' ? (isFr ? 'Validé' : 'Validated') :
    s === 'allocated' ? (isFr ? 'Mis à disposition' : 'Allocated') :
    s === 'returned' ? (isFr ? 'Retourné' : 'Returned') :
    s === 'rejected' ? (isFr ? 'Rejeté' : 'Rejected') : s;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500 p-8">
        <span className="animate-spin rounded-full h-5 w-5 border-2 border-emerald-500 border-t-transparent" />
        <span>{isFr ? 'Chargement...' : 'Loading...'}</span>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 text-gray-900">
      {mobiliteHubBanner ? (
        <div
          role="status"
          className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-950 shadow-sm"
        >
          {t('mobility_suite_banner_logistique')}
        </div>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <i className="fas fa-boxes text-emerald-600" />
            {isFr ? 'Logistique' : 'Logistics'}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5 max-w-3xl">
            {isFr
              ? 'Référence interne, stock / seuil d’alerte, maintenance prévue, actifs sensibles (rétention disque → statut destruction). Demandes : workflow validation → mise à disposition → retour. Traçabilité détaillée côté véhicules (audit) — à étendre équipements en phase 2.'
              : 'Internal ref, stock / reorder alert, planned maintenance, sensitive assets (disk retention → destruction status). Requests: validation → allocation → return. Rich traceability on fleet (audit) — equipment extension in phase 2.'}
          </p>
        </div>
      </div>

      <ModuleRichHub
        isFr={isFr}
        metrics={[
          {
            labelFr: 'Équipements',
            labelEn: 'Equipment',
            value: String(equipments.length),
            hintFr: 'Actifs suivis',
            hintEn: 'Tracked assets',
          },
          {
            labelFr: 'Demandes',
            labelEn: 'Requests',
            value: String(requests.length),
            hintFr: 'Workflow validation → mise à disposition',
            hintEn: 'Validation → allocation workflow',
          },
          {
            labelFr: 'Catégories',
            labelEn: 'Categories',
            value: String(categories.length),
            hintFr: 'Typologie interne',
            hintEn: 'Internal taxonomy',
          },
          {
            labelFr: 'Sensibles (actifs)',
            labelEn: 'Sensitive (assets)',
            value: String(equipments.filter((e) => e.sensitiveAsset).length),
            hintFr: 'Rétention / destruction',
            hintEn: 'Retention / disposal',
          },
        ]}
        sections={[
          {
            key: 'log',
            titleFr: 'Logistique & autres modules',
            titleEn: 'Logistics & other modules',
            icon: 'fas fa-boxes',
            bulletsFr: [
              'Parc Auto : véhicules et demandes de véhicule liées aux missions.',
              'Moyens généraux : demandes matériel / locaux complémentaires.',
              'Studio : équipements audiovisuels et réservations tournage.',
            ],
            bulletsEn: [
              'Fleet: vehicles and vehicle requests tied to missions.',
              'General services: complementary material / premises requests.',
              'Studio: AV equipment and shoot bookings.',
            ],
          },
        ]}
      />

      <section className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <i className="fas fa-boxes text-emerald-600" />
            {isFr ? 'Équipements' : 'Equipment'}
          </h2>
          {isManager && (
            <button type="button" onClick={openNewEquipmentForm} className="btn-3d-primary">
              <i className="fas fa-plus mr-2" />
              {isFr ? 'Nouvel équipement' : 'New equipment'}
            </button>
          )}
        </div>
        <div className="p-4">
        {showEquipForm && (
          <form onSubmit={handleSaveEquipment} className="mb-4 p-4 bg-gray-50 rounded-lg space-y-3">
            <input
              type="text"
              placeholder={isFr ? 'Nom' : 'Name'}
              value={formEquip.name}
              onChange={(e) => setFormEquip((f) => ({ ...f, name: e.target.value }))}
              className="w-full border border-gray-300 rounded px-3 py-2"
              required
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input type="text" placeholder={isFr ? 'Marque' : 'Brand'} value={formEquip.brand} onChange={(e) => setFormEquip((f) => ({ ...f, brand: e.target.value }))} className="border rounded px-3 py-2" />
              <input type="text" placeholder={isFr ? 'Modèle' : 'Model'} value={formEquip.model} onChange={(e) => setFormEquip((f) => ({ ...f, model: e.target.value }))} className="border rounded px-3 py-2" />
              <select value={formEquip.equipmentCategoryId} onChange={(e) => setFormEquip((f) => ({ ...f, equipmentCategoryId: e.target.value }))} className="border rounded px-3 py-2 bg-white">
                <option value="">{isFr ? 'Catégorie' : 'Category'}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </div>
            <input type="text" placeholder={isFr ? 'Emplacement' : 'Location'} value={formEquip.location} onChange={(e) => setFormEquip((f) => ({ ...f, location: e.target.value }))} className="w-full border rounded px-3 py-2" />
            <input
              type="text"
              placeholder={isFr ? 'Référence / numéro interne' : 'Internal reference'}
              value={formEquip.assetReference}
              onChange={(e) => setFormEquip((f) => ({ ...f, assetReference: e.target.value }))}
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                type="number"
                min={0}
                placeholder={isFr ? 'Quantité disponible' : 'Quantity on hand'}
                value={formEquip.quantityOnHand}
                onChange={(e) => setFormEquip((f) => ({ ...f, quantityOnHand: e.target.value }))}
                className="border rounded px-3 py-2"
              />
              <input
                type="number"
                min={0}
                placeholder={isFr ? 'Seuil alerte stock' : 'Reorder threshold'}
                value={formEquip.reorderThreshold}
                onChange={(e) => setFormEquip((f) => ({ ...f, reorderThreshold: e.target.value }))}
                className="border rounded px-3 py-2"
              />
              <input
                type="date"
                placeholder={isFr ? 'Prochaine maintenance' : 'Next maintenance'}
                value={formEquip.maintenanceNextDue}
                onChange={(e) => setFormEquip((f) => ({ ...f, maintenanceNextDue: e.target.value }))}
                className="border rounded px-3 py-2"
              />
            </div>
            <input
              type="number"
              min={0}
              placeholder={isFr ? 'Coût maintenance estimé (centimes)' : 'Estimated maintenance (cents)'}
              value={formEquip.maintenanceEstimatedCostCents}
              onChange={(e) => setFormEquip((f) => ({ ...f, maintenanceEstimatedCostCents: e.target.value }))}
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={formEquip.sensitiveAsset}
                onChange={(e) => setFormEquip((f) => ({ ...f, sensitiveAsset: e.target.checked }))}
              />
              {isFr ? 'Actif sensible (ex. disque dur — workflow rétention / destruction)' : 'Sensitive asset (e.g. HDD — retention / destruction)'}
            </label>
            {formEquip.sensitiveAsset && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  type="date"
                  value={formEquip.sensitiveRetentionEnd}
                  onChange={(e) => setFormEquip((f) => ({ ...f, sensitiveRetentionEnd: e.target.value }))}
                  className="border rounded px-3 py-2"
                />
                <select
                  value={formEquip.sensitiveDisposalStatus}
                  onChange={(e) =>
                    setFormEquip((f) => ({
                      ...f,
                      sensitiveDisposalStatus: e.target.value as SensitiveDisposalStatus,
                    }))
                  }
                  className="border rounded px-3 py-2"
                >
                  <option value="none">{isFr ? 'Aucun workflow' : 'None'}</option>
                  <option value="retention">{isFr ? 'Rétention en cours' : 'Retention'}</option>
                  <option value="cleared">{isFr ? 'Données effacées' : 'Data cleared'}</option>
                  <option value="destroyed">{isFr ? 'Destruction matérielle' : 'Physically destroyed'}</option>
                </select>
              </div>
            )}
            <div className="flex gap-2">
              <button type="submit" className="btn-3d-primary">{editEquipment ? (isFr ? 'Enregistrer' : 'Save') : (isFr ? 'Créer' : 'Create')}</button>
              <button type="button" onClick={resetEquipForm} className="btn-3d-secondary">{isFr ? 'Annuler' : 'Cancel'}</button>
            </div>
          </form>
        )}
        {equipments.length === 0 ? (
          <p className="text-slate-500 text-sm">{isFr ? 'Aucun équipement.' : 'No equipment.'}</p>
        ) : (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{isFr ? 'Nom' : 'Name'}</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{isFr ? 'Catégorie' : 'Category'}</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{isFr ? 'Réf.' : 'Ref.'}</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{isFr ? 'Stock' : 'Stock'}</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{isFr ? 'Marque' : 'Brand'}</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{isFr ? 'Modèle' : 'Model'}</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{isFr ? 'Emplacement' : 'Location'}</th>
                  {isManager && <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">{isFr ? 'Actions' : 'Actions'}</th>}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {equipments.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-2 text-sm font-medium">
                      <div className="flex flex-col gap-0.5">
                        <span>{e.name}</span>
                        {e.sensitiveAsset ? (
                          <span className="text-[10px] uppercase tracking-wide text-amber-700 bg-amber-50 rounded px-1.5 py-0.5 w-fit">
                            {isFr ? 'Sensible' : 'Sensitive'} · {e.sensitiveDisposalStatus}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-500">
                      {e.equipmentCategoryId ? categoryNameById.get(e.equipmentCategoryId) || '—' : '—'}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-500">{e.assetReference || '—'}</td>
                    <td className="px-4 py-2 text-sm text-gray-500">
                      <span className={e.reorderThreshold > 0 && e.quantityOnHand <= e.reorderThreshold ? 'text-red-600 font-semibold' : ''}>
                        {e.quantityOnHand}
                        {e.reorderThreshold > 0 ? ` / ≤${e.reorderThreshold}` : ''}
                      </span>
                      {e.reorderThreshold > 0 && e.quantityOnHand <= e.reorderThreshold ? (
                        <span className="ml-1 text-[10px] text-red-600">{isFr ? 'alerte' : 'low'}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-500">{e.brand || '—'}</td>
                    <td className="px-4 py-2 text-sm text-gray-500">{e.model || '—'}</td>
                    <td className="px-4 py-2 text-sm text-gray-500">{e.location || '—'}</td>
                    {isManager && (
                      <td className="px-4 py-2 text-right text-sm whitespace-nowrap">
                        <button type="button" onClick={() => openEditEquipment(e)} className="text-emerald-600 hover:text-emerald-800 mr-3">
                          {isFr ? 'Modifier' : 'Edit'}
                        </button>
                        <button type="button" onClick={() => handleArchiveEquipment(e)} className="text-red-600 hover:text-red-800">
                          {isFr ? 'Archiver' : 'Archive'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </div>
      </section>

      <section id="logistique-equipment-requests" className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <i className="fas fa-truck-loading text-emerald-600" />
            {isFr ? 'Demandes' : 'Requests'}
          </h2>
          <button
            type="button"
            onClick={() => setShowRequestForm(true)}
            disabled={equipments.length === 0}
            className="btn-3d-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <i className="fas fa-plus mr-2" />
            {isFr ? 'Nouvelle demande' : 'New request'}
          </button>
        </div>
        <div className="p-4">
        {showRequestForm && (
          <form onSubmit={handleCreateRequest} className="mb-4 p-4 bg-gray-50 rounded-lg space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{isFr ? 'Équipement' : 'Equipment'}</label>
              <select
                value={formRequest.equipmentId}
                onChange={(e) => setFormRequest((f) => ({ ...f, equipmentId: e.target.value }))}
                className="w-full border border-gray-300 rounded px-3 py-2"
                required
              >
                <option value="">— {isFr ? 'Choisir' : 'Select'} —</option>
                {equipments.map((eq) => (
                  <option key={eq.id} value={eq.id}>{eq.name}</option>
                ))}
              </select>
            </div>
            <textarea placeholder={isFr ? 'Notes (optionnel)' : 'Notes (optional)'} value={formRequest.notes} onChange={(e) => setFormRequest((f) => ({ ...f, notes: e.target.value }))} className="w-full border rounded px-3 py-2" rows={2} />
            <div className="flex gap-2">
              <button type="submit" className="btn-3d-primary">{isFr ? 'Demander' : 'Request'}</button>
              <button type="button" onClick={() => setShowRequestForm(false)} className="btn-3d-secondary">{isFr ? 'Annuler' : 'Cancel'}</button>
            </div>
          </form>
        )}
        {requests.length === 0 ? (
          <p className="text-slate-500 text-sm">{isFr ? 'Aucune demande.' : 'No requests.'}</p>
        ) : (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{isFr ? 'Équipement' : 'Equipment'}</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{isFr ? 'Statut' : 'Status'}</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{isFr ? 'Date' : 'Date'}</th>
                  {isManager && <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">{isFr ? 'Actions' : 'Actions'}</th>}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {requests.map((r) => {
                  const eq = equipments.find((e) => e.id === r.equipmentId);
                  return (
                    <tr key={r.id}>
                      <td className="px-4 py-2 text-sm font-medium">{eq?.name || r.equipmentId.slice(0, 8)}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 text-xs rounded-full ${
                          r.status === 'returned' ? 'bg-green-100 text-green-800' :
                          r.status === 'allocated' ? 'bg-blue-100 text-blue-800' :
                          r.status === 'validated' ? 'bg-amber-100 text-amber-800' :
                          r.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {statusLabel(r.status)}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-500">{r.requestedAt ? new Date(r.requestedAt).toLocaleDateString('fr-FR') : '—'}</td>
                      {isManager && (
                        <td className="px-4 py-2 text-right text-sm">
                          {r.status === 'requested' && (
                            <>
                              <button type="button" onClick={() => handleUpdateRequestStatus(r.id, 'validated')} className="text-blue-600 hover:text-blue-800 mr-2">{isFr ? 'Valider' : 'Validate'}</button>
                              <button type="button" onClick={() => handleUpdateRequestStatus(r.id, 'rejected')} className="text-red-600 hover:text-red-800">{isFr ? 'Rejeter' : 'Reject'}</button>
                            </>
                          )}
                          {r.status === 'validated' && (
                            <button type="button" onClick={() => handleUpdateRequestStatus(r.id, 'allocated')} className="text-green-600 hover:text-green-800">{isFr ? 'Mettre à disposition' : 'Allocate'}</button>
                          )}
                          {r.status === 'allocated' && (
                            <button type="button" onClick={() => handleUpdateRequestStatus(r.id, 'returned')} className="text-gray-600 hover:text-gray-800">{isFr ? 'Retour' : 'Return'}</button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        </div>
      </section>
    </div>
  );
};

export default LogistiqueModule;
