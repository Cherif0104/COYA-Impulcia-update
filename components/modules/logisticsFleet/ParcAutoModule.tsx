import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import VehicleRequestDetailPage from './VehicleRequestDetailPage';
import { fleetDesignTokens } from './fleetDesignTokens';
import { useLocalization } from '../../../contexts/LocalizationContext';
import { useModulePermissions } from '../../../hooks/useModulePermissions';
import * as parcAutoService from '../../../services/parcAutoService';
import type {
  HandoverPayload,
  OrgProjectRow,
  ProfileOption,
  TransportPartnerCompany,
  TransportPartnerVehicle,
  Vehicle,
  VehicleCatalogBrand,
  VehicleCatalogModel,
  VehiclePaymentStatus,
  VehiclePhotoRow,
  VehiclePhotoSlot,
  VehicleRequest,
  VehicleRequestStatus,
  VehicleRequestTransition,
  TransportMode,
} from '../../../services/parcAutoService';
import OrganizationService from '../../../services/organizationService';
import { useAuth } from '../../../contexts/AuthContextSupabase';
import * as programmeService from '../../../services/programmeService';
import type { Programme } from '../../../types';
import { NAV_SESSION_MOBILITE_INTENT } from '../../../contexts/AppNavigationContext';
import ModuleRichHub from '../../common/ModuleRichHub';

function randomIdPart(): string {
  return typeof globalThis.crypto !== 'undefined' && 'randomUUID' in globalThis.crypto
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function paymentStatusLabel(s: VehiclePaymentStatus, isFr: boolean): string {
  const fr: Record<VehiclePaymentStatus, string> = {
    not_invoiced: 'Non facturé',
    pending_payment: 'En attente paiement',
    paid: 'Payé',
    settled: 'Soldé',
  };
  const en: Record<VehiclePaymentStatus, string> = {
    not_invoiced: 'Not invoiced',
    pending_payment: 'Pending payment',
    paid: 'Paid',
    settled: 'Settled',
  };
  return isFr ? fr[s] : en[s];
}

function slotLabel(slot: VehiclePhotoSlot, isFr: boolean): string {
  const fr: Record<VehiclePhotoSlot, string> = {
    avant: 'Avant',
    arriere: 'Arrière',
    interieur: 'Intérieur',
    cockpit: 'Cockpit',
    bagages: 'Bagages',
    extra_1: 'Extra 1',
    extra_2: 'Extra 2',
    extra_3: 'Extra 3',
    extra_4: 'Extra 4',
    extra_5: 'Extra 5',
  };
  const en: Record<VehiclePhotoSlot, string> = {
    avant: 'Front',
    arriere: 'Rear',
    interieur: 'Interior',
    cockpit: 'Cockpit',
    bagages: 'Luggage',
    extra_1: 'Extra 1',
    extra_2: 'Extra 2',
    extra_3: 'Extra 3',
    extra_4: 'Extra 4',
    extra_5: 'Extra 5',
  };
  return isFr ? fr[slot] : en[slot];
}

function expectedN1ApproverId(
  r: VehicleRequest,
  managerByRequester: Map<string, string | null>,
): string | null {
  return r.designatedApproverProfileId || managerByRequester.get(r.requesterId) || null;
}

function readVehicleRequestIdFromUrl(): string | null {
  try {
    return new URL(window.location.href).searchParams.get(parcAutoService.VEHICLE_REQUEST_URL_PARAM);
  } catch {
    return null;
  }
}

function syncVehicleRequestUrl(id: string | null) {
  try {
    const u = new URL(window.location.href);
    if (id) u.searchParams.set(parcAutoService.VEHICLE_REQUEST_URL_PARAM, id);
    else u.searchParams.delete(parcAutoService.VEHICLE_REQUEST_URL_PARAM);
    window.history.replaceState({}, '', u.toString());
  } catch {
    /* ignore */
  }
}

const ParcAutoModule: React.FC = () => {
  const { language, t } = useLocalization();
  const { user } = useAuth();
  const { hasPermission } = useModulePermissions();
  const isFr = language === 'fr';
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [requests, setRequests] = useState<VehicleRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [projects, setProjects] = useState<OrgProjectRow[]>([]);
  const [tasks, setTasks] = useState<{ id: string; title: string }[]>([]);
  const [brands, setBrands] = useState<VehicleCatalogBrand[]>([]);
  const [catalogModels, setCatalogModels] = useState<VehicleCatalogModel[]>([]);
  const [catalogModelsLoading, setCatalogModelsLoading] = useState(false);
  const [managerByRequester, setManagerByRequester] = useState<Map<string, string | null>>(new Map());
  const [approverOptions, setApproverOptions] = useState<ProfileOption[]>([]);

  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [formVehicle, setFormVehicle] = useState({
    name: '',
    brand: '',
    model: '',
    plateNumber: '',
    location: '',
    catalogBrandId: '',
    catalogYear: '' as string | number,
    catalogModelId: '',
    catalogBrandFilter: '',
    catalogModelFilter: '',
    acquisitionKind: '' as '' | 'new' | 'used',
    odometerAcquisition: '',
    currentOdometer: '',
    purchasePriceCents: '',
    inServiceFrom: '',
    usefulLifeMonths: '',
    depreciationMethod: '',
  });
  const [formRequest, setFormRequest] = useState({
    transportMode: 'internal' as TransportMode,
    vehicleId: '',
    partnerVehicleId: '',
    programmeId: '',
    projectId: '',
    taskId: '',
    missionJustification: '',
    designatedApproverProfileId: '',
    notes: '',
    routeOrigin: '',
    routeDestination: '',
    startAt: '',
    endAt: '',
    quotedPriceCents: '',
  });
  const [partnerCompanies, setPartnerCompanies] = useState<TransportPartnerCompany[]>([]);
  const [partnerVehicles, setPartnerVehicles] = useState<TransportPartnerVehicle[]>([]);
  const [partnerForm, setPartnerForm] = useState({ name: '', contactEmail: '', phone: '', notes: '' });
  const [partnerVehicleForm, setPartnerVehicleForm] = useState({
    partnerCompanyId: '',
    label: '',
    plateNumber: '',
    seats: '',
    notes: '',
  });
  const [showAddCatalogBrand, setShowAddCatalogBrand] = useState(false);
  const [showAddCatalogModel, setShowAddCatalogModel] = useState(false);
  const [newCatalogBrandName, setNewCatalogBrandName] = useState('');
  const [newCatalogModelName, setNewCatalogModelName] = useState('');
  const [newCatalogModelYearFrom, setNewCatalogModelYearFrom] = useState('');
  const [newCatalogModelYearTo, setNewCatalogModelYearTo] = useState('');
  const [expandedVehicleId, setExpandedVehicleId] = useState<string | null>(null);
  const [vehiclePhotos, setVehiclePhotos] = useState<Record<string, VehiclePhotoRow[]>>({});
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);
  const [detailRequestId, setDetailRequestId] = useState<string | null>(() =>
    typeof window !== 'undefined' ? readVehicleRequestIdFromUrl() : null,
  );
  const [requestTransitions, setRequestTransitions] = useState<VehicleRequestTransition[]>([]);
  const [fleetBillingDraft, setFleetBillingDraft] = useState({
    quotedPriceCents: '',
    paymentStatus: 'not_invoiced' as VehiclePaymentStatus,
    invoiceNumber: '',
    priceBreakdownJson: '',
  });
  const [missionOrderFile, setMissionOrderFile] = useState<File | null>(null);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);

  const [handoverModal, setHandoverModal] = useState<{
    request: VehicleRequest;
    phase: 'checkout' | 'checkin';
    afterSaveStatus: VehicleRequestStatus;
  } | null>(null);
  const [handoverForm, setHandoverForm] = useState<HandoverPayload>({
    odometer: null,
    fuelLevelPercent: null,
    conditionNotes: null,
    maintenanceFlag: false,
  });

  const canWrite = useMemo(() => hasPermission('parc_auto', 'write'), [hasPermission]);
  const canApproveModule = useMemo(() => hasPermission('parc_auto', 'approve'), [hasPermission]);
  const isFleetRole =
    (user?.role && ['super_administrator', 'administrator', 'manager'].includes(user.role)) || canWrite || canApproveModule;

  const [fleetPortfolioTab, setFleetPortfolioTab] = useState<'enterprise' | 'partners'>('enterprise');
  const mobiliteIntentConsumedRef = useRef(false);
  const [mobiliteHubBanner, setMobiliteHubBanner] = useState(false);

  const fleetKpis = useMemo(
    () => ({
      vehiclesTotal: vehicles.length,
      vehiclesActive: vehicles.filter((x) => x.isActive).length,
      partnerCompaniesActive: partnerCompanies.filter((c) => c.active).length,
      partnerVehiclesActive: partnerVehicles.filter((v) => v.active).length,
      requestsOpen: requests.filter((x) => !['returned', 'rejected'].includes(x.status)).length,
    }),
    [vehicles, partnerCompanies, partnerVehicles, requests],
  );

  const myProfileId = user?.profileId ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    const oid = await OrganizationService.getCurrentUserOrganizationId();
    setOrgId(oid);
    if (!oid) {
      setVehicles([]);
      setRequests([]);
      setLoading(false);
      return;
    }
    const [vList, rList, progs, projs, brandList, mgrMap, approvers, pCompanies, pVehicles] = await Promise.all([
      parcAutoService.listVehicles(oid),
      parcAutoService.listVehicleRequests(oid),
      programmeService.listProgrammes(oid),
      parcAutoService.listOrgProjects(oid),
      parcAutoService.listVehicleCatalogBrands(),
      parcAutoService.getRequesterManagerMap(oid),
      parcAutoService.listApproverProfileOptions(oid),
      parcAutoService.listTransportPartnerCompanies(oid),
      parcAutoService.listTransportPartnerVehicles(oid),
    ]);
    setVehicles(vList);
    setRequests(rList);
    setProgrammes(progs);
    setProjects(projs);
    setBrands(brandList);
    setManagerByRequester(mgrMap);
    setApproverOptions(approvers);
    setPartnerCompanies(pCompanies);
    setPartnerVehicles(pVehicles);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (mobiliteIntentConsumedRef.current) return;
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(NAV_SESSION_MOBILITE_INTENT);
    } catch {
      return;
    }
    if (raw !== 'internal') return;
    mobiliteIntentConsumedRef.current = true;
    try {
      sessionStorage.removeItem(NAV_SESSION_MOBILITE_INTENT);
    } catch {
      /* ignore */
    }
    setFleetPortfolioTab('enterprise');
    setShowRequestForm(true);
    setMobiliteHubBanner(true);
    requestAnimationFrame(() => {
      document.getElementById('parc-auto-vehicle-requests')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  useEffect(() => {
    const onPop = () => {
      setDetailRequestId(readVehicleRequestIdFromUrl());
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const openRequestDetail = (id: string) => {
    setDetailRequestId(id);
    syncVehicleRequestUrl(id);
  };

  const closeRequestDetail = () => {
    setDetailRequestId(null);
    syncVehicleRequestUrl(null);
  };

  const detailListRow = useMemo(
    () => (detailRequestId ? requests.find((x) => x.id === detailRequestId) : undefined),
    [requests, detailRequestId],
  );
  const detailListSignal = detailListRow
    ? `${detailListRow.updatedAt ?? ''}|${detailListRow.status}|${detailListRow.quotedPriceCents ?? ''}`
    : null;

  useEffect(() => {
    const bid = formVehicle.catalogBrandId;
    if (!bid) {
      setCatalogModels([]);
      setCatalogModelsLoading(false);
      return;
    }
    const localBrand = parcAutoService.parseLocalBrandId(bid);
    if (localBrand) setCatalogModelsLoading(true);
    let cancelled = false;
    void (async () => {
      const models = await parcAutoService.listVehicleCatalogModels(bid);
      if (!cancelled) {
        setCatalogModels(models);
        setCatalogModelsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [formVehicle.catalogBrandId]);

  useEffect(() => {
    const name = parcAutoService.parseLocalBrandId(formVehicle.catalogBrandId);
    if (name) setFormVehicle((f) => ({ ...f, brand: name }));
  }, [formVehicle.catalogBrandId]);

  useEffect(() => {
    const m = parcAutoService.parseLocalCatalogModelMeta(formVehicle.catalogModelId);
    if (m) setFormVehicle((f) => ({ ...f, model: m.modelName }));
  }, [formVehicle.catalogModelId]);

  useEffect(() => {
    const pid = formRequest.projectId;
    if (!orgId || !pid) {
      setTasks([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const t = await parcAutoService.listProjectTasks(orgId, pid);
      if (!cancelled) setTasks(t);
    })();
    return () => {
      cancelled = true;
    };
  }, [formRequest.projectId, orgId]);

  const filteredProjects = useMemo(() => {
    if (!formRequest.programmeId) return projects;
    return projects.filter((p) => p.programmeId === formRequest.programmeId);
  }, [projects, formRequest.programmeId]);

  useEffect(() => {
    setFormVehicle((f) => ({ ...f, catalogYear: '', catalogModelId: '', catalogModelFilter: '' }));
  }, [formVehicle.catalogBrandId]);

  const catalogYears = useMemo(
    () => parcAutoService.distinctYearsFromCatalogModels(catalogModels),
    [catalogModels],
  );

  const filteredCatalogBrands = useMemo(() => {
    const q = formVehicle.catalogBrandFilter.trim().toLowerCase();
    if (!q) return brands;
    return brands.filter((b) => b.name.toLowerCase().includes(q));
  }, [brands, formVehicle.catalogBrandFilter]);

  const catalogModelsForPickers = useMemo(() => {
    const raw = formVehicle.catalogYear;
    const y = raw === '' || raw === undefined ? null : parseInt(String(raw), 10);
    const yearOk = y != null && !Number.isNaN(y) ? y : null;
    let ms = parcAutoService.filterCatalogModelsByYear(catalogModels, yearOk);
    const q = formVehicle.catalogModelFilter.trim().toLowerCase();
    if (q) ms = ms.filter((m) => m.name.toLowerCase().includes(q));
    return ms;
  }, [catalogModels, formVehicle.catalogYear, formVehicle.catalogModelFilter]);

  useEffect(() => {
    if (!expandedVehicleId) return;
    let cancelled = false;
    void (async () => {
      const rows = await parcAutoService.listVehiclePhotos(expandedVehicleId);
      if (!cancelled) setVehiclePhotos((prev) => ({ ...prev, [expandedVehicleId]: rows }));
    })();
    return () => {
      cancelled = true;
    };
  }, [expandedVehicleId]);

  useEffect(() => {
    if (!expandedRequestId) {
      setRequestTransitions([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const tr = await parcAutoService.listVehicleRequestTransitions(expandedRequestId);
      if (!cancelled) setRequestTransitions(tr);
    })();
    return () => {
      cancelled = true;
    };
  }, [expandedRequestId]);

  useEffect(() => {
    if (!expandedRequestId) return;
    const r = requests.find((x) => x.id === expandedRequestId);
    if (!r) return;
    setFleetBillingDraft({
      quotedPriceCents: r.quotedPriceCents != null ? String(r.quotedPriceCents) : '',
      paymentStatus: r.paymentStatus,
      invoiceNumber: r.invoiceNumber ?? '',
      priceBreakdownJson: r.priceBreakdown ? JSON.stringify(r.priceBreakdown, null, 2) : '{}',
    });
    setInvoiceFile(null);
  }, [expandedRequestId, requests]);

  const handleCreateVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formVehicle.name.trim()) return;
    const mid = formVehicle.catalogModelId || '';
    const localMeta = mid ? parcAutoService.parseLocalCatalogModelMeta(mid) : null;
    const vehicleCatalogModelId =
      localMeta != null || parcAutoService.isLocalCatalogModelId(mid)
        ? undefined
        : mid || undefined;
    const created = await parcAutoService.createVehicle({
      name: formVehicle.name,
      brand: (formVehicle.brand.trim() || localMeta?.brandName || undefined) || undefined,
      model: (formVehicle.model.trim() || localMeta?.modelName || undefined) || undefined,
      plateNumber: formVehicle.plateNumber || undefined,
      location: formVehicle.location || undefined,
      vehicleCatalogModelId,
      acquisitionKind: formVehicle.acquisitionKind || undefined,
      odometerAcquisition: formVehicle.odometerAcquisition ? parseInt(formVehicle.odometerAcquisition, 10) : undefined,
      currentOdometer: formVehicle.currentOdometer ? parseInt(formVehicle.currentOdometer, 10) : undefined,
      purchasePriceCents: formVehicle.purchasePriceCents ? parseInt(formVehicle.purchasePriceCents, 10) : undefined,
      inServiceFrom: formVehicle.inServiceFrom || undefined,
      usefulLifeMonths: formVehicle.usefulLifeMonths ? parseInt(formVehicle.usefulLifeMonths, 10) : undefined,
      depreciationMethod: formVehicle.depreciationMethod || undefined,
    });
    if (created) {
      setVehicles((prev) => [created, ...prev]);
      setShowVehicleForm(false);
      setFormVehicle({
        name: '',
        brand: '',
        model: '',
        plateNumber: '',
        location: '',
        catalogBrandId: '',
        catalogYear: '',
        catalogModelId: '',
        catalogBrandFilter: '',
        catalogModelFilter: '',
        acquisitionKind: '',
        odometerAcquisition: '',
        currentOdometer: '',
        purchasePriceCents: '',
        inServiceFrom: '',
        usefulLifeMonths: '',
        depreciationMethod: '',
      });
    }
  };

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formRequest.missionJustification.trim()) return;
    if (formRequest.transportMode === 'internal' && !formRequest.vehicleId) return;
    if (formRequest.transportMode === 'partner' && !formRequest.partnerVehicleId) return;
    const mgr = myProfileId ? managerByRequester.get(myProfileId) : null;
    if (!formRequest.designatedApproverProfileId && !mgr) {
      alert(
        isFr
          ? 'Aucun manager RH (fiche employé) ni approbateur désigné : renseignez un approbateur N+1.'
          : 'No HR manager on your employee record and no designated approver — pick an N+1 approver.',
      );
      return;
    }
    const oid = orgId;
    let missionOrderStoragePath: string | null | undefined;
    if (missionOrderFile && oid) {
      const ext = missionOrderFile.name.split('.').pop() || 'pdf';
      const rel = `vehicle-requests/missions/${randomIdPart()}.${ext}`;
      missionOrderStoragePath = await parcAutoService.uploadFleetPrivateObject({
        organizationId: oid,
        relativePath: rel,
        file: missionOrderFile,
        contentType: missionOrderFile.type || undefined,
      });
      if (!missionOrderStoragePath) {
        alert(isFr ? 'Échec upload ordre de mission.' : 'Mission order upload failed.');
        return;
      }
    }

    const created = await parcAutoService.createVehicleRequest({
      transportMode: formRequest.transportMode,
      vehicleId: formRequest.transportMode === 'internal' ? formRequest.vehicleId : null,
      partnerVehicleId: formRequest.transportMode === 'partner' ? formRequest.partnerVehicleId : null,
      notes: formRequest.notes || undefined,
      programmeId: formRequest.programmeId || null,
      projectId: formRequest.projectId || null,
      taskId: formRequest.taskId || null,
      missionJustification: formRequest.missionJustification,
      designatedApproverProfileId: formRequest.designatedApproverProfileId || null,
      routeOrigin: formRequest.routeOrigin || null,
      routeDestination: formRequest.routeDestination || null,
      missionOrderStoragePath: missionOrderStoragePath ?? null,
      startAt: formRequest.startAt ? new Date(formRequest.startAt).toISOString() : null,
      endAt: formRequest.endAt ? new Date(formRequest.endAt).toISOString() : null,
      quotedPriceCents: formRequest.quotedPriceCents ? parseInt(formRequest.quotedPriceCents, 10) : null,
    });
    if (created) {
      setRequests((prev) => [created, ...prev]);
      setShowRequestForm(false);
      setMissionOrderFile(null);
      setFormRequest({
        transportMode: 'internal',
        vehicleId: '',
        partnerVehicleId: '',
        programmeId: '',
        projectId: '',
        taskId: '',
        missionJustification: '',
        designatedApproverProfileId: '',
        notes: '',
        routeOrigin: '',
        routeDestination: '',
        startAt: '',
        endAt: '',
        quotedPriceCents: '',
      });
    }
  };

  const handleUpdateRequestStatus = async (id: string, status: VehicleRequestStatus) => {
    const r = requests.find((x) => x.id === id);
    const oid = r?.organizationId || orgId;
    const ok = await parcAutoService.updateVehicleRequestStatus(id, status, oid || undefined);
    if (ok) void load();
  };

  const openHandover = (request: VehicleRequest, phase: 'checkout' | 'checkin', afterSaveStatus: VehicleRequestStatus) => {
    setHandoverForm({
      odometer: null,
      fuelLevelPercent: null,
      conditionNotes: null,
      maintenanceFlag: false,
    });
    setHandoverModal({ request, phase, afterSaveStatus });
  };

  const submitHandover = async () => {
    if (!handoverModal || !orgId) return;
    const ok = await parcAutoService.saveVehicleHandover({
      vehicleRequestId: handoverModal.request.id,
      organizationId: orgId,
      phase: handoverModal.phase,
      payload: handoverForm,
    });
    if (!ok) return;
    await parcAutoService.updateVehicleRequestStatus(
      handoverModal.request.id,
      handoverModal.afterSaveStatus,
      orgId,
    );
    setHandoverModal(null);
    void load();
  };

  const statusLabel = (s: string) => {
    if (s === 'pending_n1') return isFr ? 'Attente N+1' : 'Pending line manager';
    if (s === 'pending_fleet') return isFr ? 'Attente flotte / DAF' : 'Pending fleet';
    if (s === 'validated') return isFr ? 'Validé (flotte)' : 'Fleet validated';
    if (s === 'allocated') return isFr ? 'Mis à disposition' : 'Allocated';
    if (s === 'returned') return isFr ? 'Retourné' : 'Returned';
    if (s === 'rejected') return isFr ? 'Rejeté' : 'Rejected';
    return s;
  };

  const canActN1On = (r: VehicleRequest) =>
    r.status === 'pending_n1' &&
    myProfileId &&
    expectedN1ApproverId(r, managerByRequester) === myProfileId;

  const canActFleetOn = (r: VehicleRequest) =>
    isFleetRole && ['pending_fleet', 'validated', 'allocated'].includes(r.status);

  const canEditFleetBilling = (r: VehicleRequest) =>
    isFleetRole && ['pending_fleet', 'validated', 'allocated', 'returned'].includes(r.status);

  const submitFleetBillingPatch = async (requestId: string) => {
    const r = requests.find((x) => x.id === requestId);
    if (!r || !orgId) return;
    let invoiceStoragePath: string | null | undefined = r.invoiceStoragePath ?? null;
    if (invoiceFile) {
      const ext = invoiceFile.name.split('.').pop() || 'pdf';
      const rel = `vehicle-requests/invoices/${randomIdPart()}.${ext}`;
      const up = await parcAutoService.uploadFleetPrivateObject({
        organizationId: orgId,
        relativePath: rel,
        file: invoiceFile,
        contentType: invoiceFile.type || undefined,
      });
      if (!up) {
        alert(isFr ? 'Échec upload facture.' : 'Invoice upload failed.');
        return;
      }
      invoiceStoragePath = up;
    }
    if (['paid', 'settled'].includes(fleetBillingDraft.paymentStatus) && !invoiceStoragePath) {
      alert(isFr ? 'Statut payé/soldé : joindre une facture.' : 'Paid/settled requires an invoice attachment.');
      return;
    }
    let priceBreakdown: Record<string, unknown> = {};
    try {
      priceBreakdown = fleetBillingDraft.priceBreakdownJson.trim()
        ? (JSON.parse(fleetBillingDraft.priceBreakdownJson) as Record<string, unknown>)
        : {};
    } catch {
      alert(isFr ? 'JSON détail prix invalide.' : 'Invalid price breakdown JSON.');
      return;
    }
    const ok = await parcAutoService.patchVehicleRequestFleetFields(requestId, {
      quotedPriceCents: fleetBillingDraft.quotedPriceCents.trim()
        ? parseInt(fleetBillingDraft.quotedPriceCents, 10)
        : null,
      priceBreakdown,
      paymentStatus: fleetBillingDraft.paymentStatus,
      invoiceStoragePath,
      invoiceNumber: fleetBillingDraft.invoiceNumber.trim() || null,
    });
    if (ok) {
      setInvoiceFile(null);
      void load();
    }
  };

  return (
    <>
      {detailRequestId ? (
        <VehicleRequestDetailPage
          requestId={detailRequestId}
          listRowSignal={detailListSignal}
          onBack={closeRequestDetail}
          isFr={isFr}
          orgId={orgId}
          myProfileId={myProfileId}
          managerByRequester={managerByRequester}
          isFleetRole={!!isFleetRole}
          onUpdateRequestStatus={handleUpdateRequestStatus}
          onOpenHandover={openHandover}
          onAfterMutation={load}
        />
      ) : loading ? (
        <div className="flex items-center gap-2 text-slate-500 p-8">
          <span className="animate-spin rounded-full h-5 w-5 border-2 border-emerald-500 border-t-transparent" />
          <span>{isFr ? 'Chargement...' : 'Loading...'}</span>
        </div>
      ) : (
        <div className="p-6 space-y-6 text-gray-900">
      {mobiliteHubBanner ? (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 shadow-sm"
        >
          {t('mobility_suite_banner_parc')}
        </div>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <i className="fas fa-car text-emerald-600" />
            {isFr ? 'Parc Auto' : 'Fleet management'}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5 max-w-3xl">
            {isFr
              ? 'Flotte interne et prestataires, catalogue marque → année → modèle, photos véhicules, tarification et facturation, traçabilité des statuts et créneaux dans le planning.'
              : 'Internal fleet and partners, brand → year → model catalog, vehicle photos, pricing and invoicing, status traceability and planning slots.'}
          </p>
        </div>
      </div>

      <ModuleRichHub
        isFr={isFr}
        metrics={[
          {
            labelFr: 'Véhicules',
            labelEn: 'Vehicles',
            value: String(vehicles.length),
            hintFr: 'Flotte interne + affectations',
            hintEn: 'Internal fleet + assignments',
          },
          {
            labelFr: 'Demandes mobilité',
            labelEn: 'Mobility requests',
            value: String(requests.length),
            hintFr: 'Tous statuts',
            hintEn: 'All statuses',
          },
          {
            labelFr: 'En cours de traitement',
            labelEn: 'In progress',
            value: String(
              requests.filter((r) => !['returned', 'rejected'].includes(r.status)).length,
            ),
            hintFr: 'Hors retournées / refusées',
            hintEn: 'Excluding returned / rejected',
          },
          {
            labelFr: 'Programmes liés',
            labelEn: 'Linked programmes',
            value: String(programmes.length),
            hintFr: 'Rattachement mission',
            hintEn: 'Mission linkage',
          },
        ]}
        sections={[
          {
            key: 'fleet',
            titleFr: 'Parc & autres vues',
            titleEn: 'Fleet & related views',
            icon: 'fas fa-car',
            bulletsFr: [
              'Planning : créneaux et missions synchronisés lorsque disponibles.',
              'Logistique : équipements non véhicules (complémentaire).',
              'Moyens généraux : demandes déplacement / mission.',
            ],
            bulletsEn: [
              'Planning: slots and missions when synced.',
              'Logistics: non-vehicle equipment (complementary).',
              'General services: travel / mission requests.',
            ],
          },
        ]}
      />

      <div className={`${fleetDesignTokens.surfaceCard} p-4 mb-2`}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3 mb-3">
          <button
            type="button"
            onClick={() => setFleetPortfolioTab('enterprise')}
            className={`rounded-full px-4 py-2 text-xs font-semibold border transition-colors ${
              fleetPortfolioTab === 'enterprise'
                ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            <i className="fas fa-building mr-2" aria-hidden />
            {isFr ? 'Flotte entreprise' : 'Enterprise fleet'}
          </button>
          <button
            type="button"
            onClick={() => setFleetPortfolioTab('partners')}
            className={`rounded-full px-4 py-2 text-xs font-semibold border transition-colors ${
              fleetPortfolioTab === 'partners'
                ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            <i className="fas fa-handshake mr-2" aria-hidden />
            {isFr ? 'Prestataires & partenaires' : 'Partners & contractors'}
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
          <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3">
            <div className="text-[10px] uppercase text-slate-400">{isFr ? 'Véhicules' : 'Vehicles'}</div>
            <div className="text-lg font-bold text-slate-900">{fleetKpis.vehiclesTotal}</div>
            <div className="text-[10px] text-slate-500">{isFr ? `Actifs ${fleetKpis.vehiclesActive}` : `Active ${fleetKpis.vehiclesActive}`}</div>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3">
            <div className="text-[10px] uppercase text-slate-400">{isFr ? 'Prestataires' : 'Partners'}</div>
            <div className="text-lg font-bold text-slate-900">{fleetKpis.partnerCompaniesActive}</div>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3">
            <div className="text-[10px] uppercase text-slate-400">{isFr ? 'Véh. partenaires' : 'Partner veh.'}</div>
            <div className="text-lg font-bold text-slate-900">{fleetKpis.partnerVehiclesActive}</div>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3">
            <div className="text-[10px] uppercase text-slate-400">{isFr ? 'Demandes ouvertes' : 'Open requests'}</div>
            <div className="text-lg font-bold text-slate-900">{fleetKpis.requestsOpen}</div>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3 hidden sm:block">
            <div className="text-[10px] uppercase text-slate-400">{isFr ? 'Disponibilité' : 'Availability'}</div>
            <div className="text-xs font-medium text-slate-700 mt-1">
              {isFr ? 'Indicateur bientôt (occupation).' : 'Indicator soon (utilization).'}
            </div>
          </div>
        </div>
      </div>

      {fleetPortfolioTab === 'partners' && (
        <section className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-slate-200">
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <i className="fas fa-handshake text-emerald-600" />
              {isFr ? 'Prestataires transport' : 'Transport partners'}
            </h2>
          </div>
          <div className="p-4 space-y-4">
            {isFleetRole ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <form
              className="space-y-2 p-3 bg-slate-50 rounded-lg border border-slate-200"
              onSubmit={async (e) => {
                e.preventDefault();
                const created = await parcAutoService.createTransportPartnerCompany({
                  name: partnerForm.name,
                  contactEmail: partnerForm.contactEmail || undefined,
                  phone: partnerForm.phone || undefined,
                  notes: partnerForm.notes || undefined,
                });
                if (created) {
                  setPartnerCompanies((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
                  setPartnerForm({ name: '', contactEmail: '', phone: '', notes: '' });
                }
              }}
            >
              <div className="text-sm font-medium text-slate-800">
                {isFr ? 'Nouveau prestataire' : 'New partner company'}
              </div>
              <input
                required
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                placeholder={isFr ? 'Raison sociale' : 'Company name'}
                value={partnerForm.name}
                onChange={(e) => setPartnerForm((f) => ({ ...f, name: e.target.value }))}
              />
              <input
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                placeholder="Email"
                value={partnerForm.contactEmail}
                onChange={(e) => setPartnerForm((f) => ({ ...f, contactEmail: e.target.value }))}
              />
              <input
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                placeholder={isFr ? 'Téléphone' : 'Phone'}
                value={partnerForm.phone}
                onChange={(e) => setPartnerForm((f) => ({ ...f, phone: e.target.value }))}
              />
              <textarea
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                placeholder={isFr ? 'Notes' : 'Notes'}
                rows={2}
                value={partnerForm.notes}
                onChange={(e) => setPartnerForm((f) => ({ ...f, notes: e.target.value }))}
              />
              <button type="submit" className="btn-3d-primary text-sm">
                {isFr ? 'Enregistrer' : 'Save'}
              </button>
            </form>
            <form
              className="space-y-2 p-3 bg-slate-50 rounded-lg border border-slate-200"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!partnerVehicleForm.partnerCompanyId || !partnerVehicleForm.label.trim()) return;
                const created = await parcAutoService.createTransportPartnerVehicle({
                  partnerCompanyId: partnerVehicleForm.partnerCompanyId,
                  label: partnerVehicleForm.label,
                  plateNumber: partnerVehicleForm.plateNumber || undefined,
                  seats: partnerVehicleForm.seats ? parseInt(partnerVehicleForm.seats, 10) : undefined,
                  notes: partnerVehicleForm.notes || undefined,
                });
                if (created) {
                  setPartnerVehicles((prev) => [...prev, created]);
                  setPartnerVehicleForm({
                    partnerCompanyId: '',
                    label: '',
                    plateNumber: '',
                    seats: '',
                    notes: '',
                  });
                }
              }}
            >
              <div className="text-sm font-medium text-slate-800">
                {isFr ? 'Véhicule prestataire (catalogue)' : 'Partner vehicle (catalog)'}
              </div>
              <select
                required
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                value={partnerVehicleForm.partnerCompanyId}
                onChange={(e) => setPartnerVehicleForm((f) => ({ ...f, partnerCompanyId: e.target.value }))}
              >
                <option value="">{isFr ? '— Prestataire —' : '— Partner —'}</option>
                {partnerCompanies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                required
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                placeholder={isFr ? 'Libellé (ex. Van 9 places)' : 'Label'}
                value={partnerVehicleForm.label}
                onChange={(e) => setPartnerVehicleForm((f) => ({ ...f, label: e.target.value }))}
              />
              <input
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                placeholder={isFr ? 'Immatriculation' : 'Plate'}
                value={partnerVehicleForm.plateNumber}
                onChange={(e) => setPartnerVehicleForm((f) => ({ ...f, plateNumber: e.target.value }))}
              />
              <input
                type="number"
                min={1}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                placeholder={isFr ? 'Places' : 'Seats'}
                value={partnerVehicleForm.seats}
                onChange={(e) => setPartnerVehicleForm((f) => ({ ...f, seats: e.target.value }))}
              />
              <textarea
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                rows={2}
                placeholder={isFr ? 'Notes' : 'Notes'}
                value={partnerVehicleForm.notes}
                onChange={(e) => setPartnerVehicleForm((f) => ({ ...f, notes: e.target.value }))}
              />
              <button type="submit" className="btn-3d-primary text-sm">
                {isFr ? 'Ajouter au catalogue' : 'Add to catalog'}
              </button>
            </form>
          </div>
            ) : (
              <p className="text-sm text-slate-500">
                {isFr
                  ? 'Catalogue prestataires en lecture seule. Contactez un gestionnaire parc pour ajouter des entrées.'
                  : 'Partner catalog is read-only. Ask a fleet manager to add entries.'}
              </p>
            )}
          <div className="space-y-4 border-t border-slate-100 pt-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-800 mb-2">{isFr ? 'Entreprises partenaires' : 'Partner companies'}</h3>
              {partnerCompanies.length === 0 ? (
                <p className="text-xs text-slate-500">{isFr ? 'Aucun prestataire.' : 'No partner companies.'}</p>
              ) : (
                <div className="border border-slate-200 rounded-xl overflow-x-auto bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">{isFr ? 'Nom' : 'Name'}</th>
                        <th className="px-3 py-2">Email</th>
                        <th className="px-3 py-2">{isFr ? 'Tél.' : 'Phone'}</th>
                        <th className="px-3 py-2">{isFr ? 'Actif' : 'Active'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {partnerCompanies.map((c) => (
                        <tr key={c.id}>
                          <td className="px-3 py-2 font-medium text-slate-900">{c.name}</td>
                          <td className="px-3 py-2 text-slate-600">{c.contactEmail || '—'}</td>
                          <td className="px-3 py-2 text-slate-600">{c.phone || '—'}</td>
                          <td className="px-3 py-2">{c.active ? (isFr ? 'Oui' : 'Yes') : (isFr ? 'Non' : 'No')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-800 mb-2">{isFr ? 'Véhicules catalogue partenaires' : 'Partner catalog vehicles'}</h3>
              {partnerVehicles.length === 0 ? (
                <p className="text-xs text-slate-500">{isFr ? 'Aucun véhicule partenaire.' : 'No partner vehicles.'}</p>
              ) : (
                <div className="border border-slate-200 rounded-xl overflow-x-auto bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">{isFr ? 'Prestataire' : 'Partner'}</th>
                        <th className="px-3 py-2">{isFr ? 'Libellé' : 'Label'}</th>
                        <th className="px-3 py-2">{isFr ? 'Immat.' : 'Plate'}</th>
                        <th className="px-3 py-2">{isFr ? 'Places' : 'Seats'}</th>
                        <th className="px-3 py-2">{isFr ? 'Actif' : 'Active'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {partnerVehicles.map((pv) => {
                        const cn = partnerCompanies.find((x) => x.id === pv.partnerCompanyId)?.name || '—';
                        return (
                          <tr key={pv.id}>
                            <td className="px-3 py-2 text-slate-700">{cn}</td>
                            <td className="px-3 py-2 font-medium text-slate-900">{pv.label}</td>
                            <td className="px-3 py-2 text-slate-600">{pv.plateNumber || '—'}</td>
                            <td className="px-3 py-2 text-slate-600">{pv.seats ?? '—'}</td>
                            <td className="px-3 py-2">{pv.active ? (isFr ? 'Oui' : 'Yes') : (isFr ? 'Non' : 'No')}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
          </div>
        </section>
      )}

      {fleetPortfolioTab === 'enterprise' && (
        <section className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <i className="fas fa-car text-emerald-600" />
            {isFr ? 'Véhicules' : 'Vehicles'}
          </h2>
          {isFleetRole && (
            <button type="button" onClick={() => setShowVehicleForm(true)} className="btn-3d-primary">
              <i className="fas fa-plus mr-2" />
              {isFr ? 'Nouveau véhicule' : 'New vehicle'}
            </button>
          )}
        </div>
        <div className="p-4">
          {showVehicleForm && (
            <form onSubmit={handleCreateVehicle} className="mb-4 p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
              <input
                type="text"
                placeholder={isFr ? 'Nom / désignation' : 'Name'}
                value={formVehicle.name}
                onChange={(e) => setFormVehicle((f) => ({ ...f, name: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2"
                required
              />
              {brands.some((b) => parcAutoService.isLocalCatalogBrandId(b.id)) ? (
                <div
                  role="status"
                  className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1"
                >
                  <p>
                    {isFr
                      ? 'Catalogue étendu chargé côté application (hors base). Les sélections marque/modèle remplissent les champs libres ; lien catalogue Supabase non enregistré tant que le seed complet n’est pas appliqué.'
                      : 'Extended catalog loaded client-side (not from DB). Brand/model picks fill free-text fields; no Supabase catalog link until full seed is applied.'}
                  </p>
                  <p>
                    {isFr ? (
                      <>
                        Pour la production, exécutez le script de seed documenté dans{' '}
                        <code className="bg-amber-100 px-1 rounded">data/README.txt</code> (
                        <code className="bg-amber-100 px-1 rounded">scripts/seed-vehicle-catalog.mjs</code>
                        ).
                      </>
                    ) : (
                      <>
                        For production, run the seed script documented in{' '}
                        <code className="bg-amber-100 px-1 rounded">data/README.txt</code> (
                        <code className="bg-amber-100 px-1 rounded">scripts/seed-vehicle-catalog.mjs</code>
                        ).
                      </>
                    )}
                  </p>
                </div>
              ) : null}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-slate-600">
                    {isFr ? 'Catalogue — marque (filtre)' : 'Catalog — brand (filter)'}
                  </label>
                  <input
                    type="search"
                    value={formVehicle.catalogBrandFilter}
                    onChange={(e) => setFormVehicle((f) => ({ ...f, catalogBrandFilter: e.target.value }))}
                    placeholder={isFr ? 'Rechercher une marque…' : 'Search brand…'}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                  <select
                    size={8}
                    value={formVehicle.catalogBrandId}
                    onChange={(e) =>
                      setFormVehicle((f) => ({
                        ...f,
                        catalogBrandId: e.target.value,
                        catalogModelId: '',
                      }))
                    }
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm max-h-48"
                  >
                    <option value="">{isFr ? '— Manuel (pas de lien catalogue) —' : '— Manual (no catalog link) —'}</option>
                    {filteredCatalogBrands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  {isFleetRole && (
                    <button
                      type="button"
                      className="text-xs text-emerald-700 underline"
                      onClick={() => setShowAddCatalogBrand(true)}
                    >
                      {isFr ? '+ Ajouter une marque au catalogue' : '+ Add catalog brand'}
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-slate-600">
                    {isFr ? 'Année du véhicule (filtre modèles)' : 'Vehicle year (model filter)'}
                  </label>
                  <select
                    value={formVehicle.catalogYear === '' ? '' : String(formVehicle.catalogYear)}
                    onChange={(e) =>
                      setFormVehicle((f) => ({
                        ...f,
                        catalogYear: e.target.value === '' ? '' : parseInt(e.target.value, 10),
                        catalogModelId: '',
                      }))
                    }
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    disabled={!formVehicle.catalogBrandId || catalogModelsLoading}
                  >
                    <option value="">{isFr ? '— Toutes années —' : '— All years —'}</option>
                    {catalogYears.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                  <label className="block text-xs font-medium text-slate-600">
                    {isFr ? 'Catalogue — modèle (filtre)' : 'Catalog — model (filter)'}
                  </label>
                  <input
                    type="search"
                    value={formVehicle.catalogModelFilter}
                    onChange={(e) => setFormVehicle((f) => ({ ...f, catalogModelFilter: e.target.value }))}
                    placeholder={isFr ? 'Rechercher un modèle…' : 'Search model…'}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    disabled={!formVehicle.catalogBrandId || catalogModelsLoading}
                  />
                  {catalogModelsLoading ? (
                    <p className="text-xs text-slate-500 flex items-center gap-2">
                      <span className="inline-block h-3 w-3 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                      {isFr ? 'Chargement des modèles (premier accès : fichier volumineux)…' : 'Loading models (first load may be large)…'}
                    </p>
                  ) : null}
                  <select
                    size={6}
                    value={formVehicle.catalogModelId}
                    onChange={(e) => setFormVehicle((f) => ({ ...f, catalogModelId: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm max-h-40"
                    disabled={!formVehicle.catalogBrandId || catalogModelsLoading}
                  >
                    <option value="">{isFr ? '— Choisir un modèle —' : '— Pick a model —'}</option>
                    {catalogModelsForPickers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {m.yearFrom != null ? ` (${m.yearFrom}${m.yearTo != null ? `–${m.yearTo}` : '+'})` : ''}
                      </option>
                    ))}
                  </select>
                  {isFleetRole && (
                    <button
                      type="button"
                      className="text-xs text-emerald-700 underline"
                      onClick={() => setShowAddCatalogModel(true)}
                      disabled={!formVehicle.catalogBrandId}
                    >
                      {isFr ? '+ Ajouter un modèle au catalogue' : '+ Add catalog model'}
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs text-slate-500">
                {isFr
                  ? 'Marque → année → modèle. Import massif : voir data/README.txt et scripts/seed-vehicle-catalog.mjs.'
                  : 'Brand → year → model. Bulk import: see data/README.txt and scripts/seed-vehicle-catalog.mjs.'}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  type="text"
                  placeholder={isFr ? 'Marque (libre)' : 'Brand (free text)'}
                  value={formVehicle.brand}
                  onChange={(e) => setFormVehicle((f) => ({ ...f, brand: e.target.value }))}
                  className="border border-slate-300 rounded-lg px-3 py-2"
                />
                <input
                  type="text"
                  placeholder={isFr ? 'Modèle (libre)' : 'Model (free text)'}
                  value={formVehicle.model}
                  onChange={(e) => setFormVehicle((f) => ({ ...f, model: e.target.value }))}
                  className="border border-slate-300 rounded-lg px-3 py-2"
                />
                <input
                  type="text"
                  placeholder={isFr ? 'Immatriculation' : 'Plate number'}
                  value={formVehicle.plateNumber}
                  onChange={(e) => setFormVehicle((f) => ({ ...f, plateNumber: e.target.value }))}
                  className="border border-slate-300 rounded-lg px-3 py-2"
                />
              </div>
              <input
                type="text"
                placeholder={isFr ? 'Emplacement' : 'Location'}
                value={formVehicle.location}
                onChange={(e) => setFormVehicle((f) => ({ ...f, location: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2"
              />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <select
                  value={formVehicle.acquisitionKind}
                  onChange={(e) =>
                    setFormVehicle((f) => ({
                      ...f,
                      acquisitionKind: e.target.value as '' | 'new' | 'used',
                    }))
                  }
                  className="border border-slate-300 rounded-lg px-3 py-2"
                >
                  <option value="">{isFr ? 'Neuf / occasion' : 'New / used'}</option>
                  <option value="new">{isFr ? 'Neuf' : 'New'}</option>
                  <option value="used">{isFr ? 'Occasion' : 'Used'}</option>
                </select>
                <input
                  type="number"
                  placeholder={isFr ? 'Km à l’achat' : 'Odometer at purchase'}
                  value={formVehicle.odometerAcquisition}
                  onChange={(e) => setFormVehicle((f) => ({ ...f, odometerAcquisition: e.target.value }))}
                  className="border border-slate-300 rounded-lg px-3 py-2"
                />
                <input
                  type="number"
                  placeholder={isFr ? 'Km actuel' : 'Current odometer'}
                  value={formVehicle.currentOdometer}
                  onChange={(e) => setFormVehicle((f) => ({ ...f, currentOdometer: e.target.value }))}
                  className="border border-slate-300 rounded-lg px-3 py-2"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  type="number"
                  placeholder={isFr ? 'Prix achat (centimes)' : 'Purchase price (cents)'}
                  value={formVehicle.purchasePriceCents}
                  onChange={(e) => setFormVehicle((f) => ({ ...f, purchasePriceCents: e.target.value }))}
                  className="border border-slate-300 rounded-lg px-3 py-2"
                />
                <input
                  type="date"
                  placeholder={isFr ? 'Mise en service' : 'In service from'}
                  value={formVehicle.inServiceFrom}
                  onChange={(e) => setFormVehicle((f) => ({ ...f, inServiceFrom: e.target.value }))}
                  className="border border-slate-300 rounded-lg px-3 py-2"
                />
                <input
                  type="number"
                  placeholder={isFr ? 'Durée de vie utile (mois)' : 'Useful life (months)'}
                  value={formVehicle.usefulLifeMonths}
                  onChange={(e) => setFormVehicle((f) => ({ ...f, usefulLifeMonths: e.target.value }))}
                  className="border border-slate-300 rounded-lg px-3 py-2"
                />
              </div>
              <input
                type="text"
                placeholder={isFr ? 'Méthode amortissement (libre)' : 'Depreciation method'}
                value={formVehicle.depreciationMethod}
                onChange={(e) => setFormVehicle((f) => ({ ...f, depreciationMethod: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2"
              />
              <div className="flex gap-2">
                <button type="submit" className="btn-3d-primary">
                  {isFr ? 'Créer' : 'Create'}
                </button>
                <button type="button" onClick={() => setShowVehicleForm(false)} className="btn-3d-secondary">
                  {isFr ? 'Annuler' : 'Cancel'}
                </button>
              </div>
            </form>
          )}
          {vehicles.length === 0 ? (
            <p className="text-slate-500 text-sm">{isFr ? 'Aucun véhicule.' : 'No vehicles.'}</p>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-hidden overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-2 py-2 w-10" aria-label="expand" />
                    <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">{isFr ? 'Nom' : 'Name'}</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">{isFr ? 'Marque' : 'Brand'}</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">{isFr ? 'Modèle' : 'Model'}</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">{isFr ? 'Immat.' : 'Plate'}</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">{isFr ? 'Km' : 'Km'}</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">{isFr ? 'Emplacement' : 'Location'}</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200">
                  {vehicles.map((v) => (
                    <React.Fragment key={v.id}>
                      <tr>
                        <td className="px-2 py-2">
                          {isFleetRole ? (
                            <button
                              type="button"
                              className="text-emerald-700 text-xs underline"
                              onClick={() => setExpandedVehicleId((id) => (id === v.id ? null : v.id))}
                            >
                              {expandedVehicleId === v.id ? '−' : '+'}
                            </button>
                          ) : (
                            <span className="text-slate-300">·</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-sm font-medium text-slate-900">{v.name}</td>
                        <td className="px-4 py-2 text-sm text-slate-500">{v.brand || '—'}</td>
                        <td className="px-4 py-2 text-sm text-slate-500">{v.model || '—'}</td>
                        <td className="px-4 py-2 text-sm text-slate-500">{v.plateNumber || '—'}</td>
                        <td className="px-4 py-2 text-sm text-slate-500">{v.currentOdometer ?? '—'}</td>
                        <td className="px-4 py-2 text-sm text-slate-500">{v.location || '—'}</td>
                      </tr>
                      {expandedVehicleId === v.id && isFleetRole && orgId ? (
                        <tr className="bg-slate-50">
                          <td colSpan={7} className="px-4 py-3">
                            <div className="text-xs font-semibold text-slate-700 mb-2">
                              {isFr ? 'Photos (slots)' : 'Photos (slots)'}
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                              {parcAutoService.VEHICLE_PHOTO_SLOT_ORDER.map((slot) => {
                                const row = (vehiclePhotos[v.id] || []).find((x) => x.slot === slot);
                                return (
                                  <div key={slot} className="border border-slate-200 rounded-lg p-2 bg-white">
                                    <div className="text-xs font-medium text-slate-600 mb-1">{slotLabel(slot, isFr)}</div>
                                    {row ? (
                                      <div className="text-[10px] text-slate-500 break-all">{row.storagePath}</div>
                                    ) : (
                                      <span className="text-[10px] text-slate-400">{isFr ? 'Vide' : 'Empty'}</span>
                                    )}
                                    <input
                                      type="file"
                                      accept="image/*"
                                      className="text-[10px] mt-1 w-full"
                                      onChange={async (e) => {
                                        const file = e.target.files?.[0];
                                        if (!file || !orgId) return;
                                        const up = await parcAutoService.upsertVehiclePhoto({
                                          organizationId: orgId,
                                          vehicleId: v.id,
                                          slot,
                                          file,
                                          contentType: file.type || undefined,
                                        });
                                        if (up) {
                                          setVehiclePhotos((prev) => ({
                                            ...prev,
                                            [v.id]: [...(prev[v.id] || []).filter((x) => x.slot !== slot), up],
                                          }));
                                        }
                                      }}
                                    />
                                    {row ? (
                                      <button
                                        type="button"
                                        className="text-[10px] text-red-600 mt-1 underline"
                                        onClick={async () => {
                                          const ok = await parcAutoService.deleteVehiclePhoto(row.id);
                                          if (ok) {
                                            setVehiclePhotos((prev) => ({
                                              ...prev,
                                              [v.id]: (prev[v.id] || []).filter((x) => x.id !== row.id),
                                            }));
                                          }
                                        }}
                                      >
                                        {isFr ? 'Supprimer' : 'Delete'}
                                      </button>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
      )}

      <section id="parc-auto-vehicle-requests" className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <i className="fas fa-truck-loading text-emerald-600" />
            {isFr ? 'Demandes véhicules' : 'Vehicle requests'}
          </h2>
          <button
            type="button"
            onClick={() => setShowRequestForm(true)}
            disabled={vehicles.length === 0 && partnerVehicles.length === 0}
            className="btn-3d-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <i className="fas fa-plus mr-2" />
            {isFr ? 'Nouvelle demande' : 'New request'}
          </button>
        </div>
        <div className="p-4">
          {showRequestForm && (
            <form onSubmit={handleCreateRequest} className="mb-4 p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="tm"
                    checked={formRequest.transportMode === 'internal'}
                    onChange={() => setFormRequest((f) => ({ ...f, transportMode: 'internal', partnerVehicleId: '' }))}
                  />
                  {isFr ? 'Flotte interne' : 'Internal fleet'}
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="tm"
                    checked={formRequest.transportMode === 'partner'}
                    onChange={() => setFormRequest((f) => ({ ...f, transportMode: 'partner', vehicleId: '' }))}
                  />
                  {isFr ? 'Prestataire externe' : 'External partner'}
                </label>
              </div>
              {formRequest.transportMode === 'internal' ? (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{isFr ? 'Véhicule' : 'Vehicle'}</label>
                  <select
                    value={formRequest.vehicleId}
                    onChange={(e) => setFormRequest((f) => ({ ...f, vehicleId: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2"
                    required={formRequest.transportMode === 'internal'}
                  >
                    <option value="">— {isFr ? 'Choisir' : 'Select'} —</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} {v.plateNumber ? `(${v.plateNumber})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {isFr ? 'Véhicule prestataire' : 'Partner vehicle'}
                  </label>
                  <select
                    value={formRequest.partnerVehicleId}
                    onChange={(e) => setFormRequest((f) => ({ ...f, partnerVehicleId: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2"
                    required={formRequest.transportMode === 'partner'}
                  >
                    <option value="">— {isFr ? 'Choisir' : 'Select'} —</option>
                    {partnerVehicles.map((pv) => {
                      const cn =
                        partnerCompanies.find((c) => c.id === pv.partnerCompanyId)?.name || '';
                      return (
                        <option key={pv.id} value={pv.id}>
                          {cn ? `${cn} — ` : ''}
                          {pv.label}
                          {pv.plateNumber ? ` (${pv.plateNumber})` : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{isFr ? 'Programme' : 'Programme'}</label>
                  <select
                    value={formRequest.programmeId}
                    onChange={(e) =>
                      setFormRequest((f) => ({
                        ...f,
                        programmeId: e.target.value,
                        projectId: '',
                        taskId: '',
                      }))
                    }
                    className="w-full border border-slate-300 rounded-lg px-3 py-2"
                  >
                    <option value="">{isFr ? '— Optionnel —' : '— Optional —'}</option>
                    {programmes.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{isFr ? 'Projet' : 'Project'}</label>
                  <select
                    value={formRequest.projectId}
                    onChange={(e) => setFormRequest((f) => ({ ...f, projectId: e.target.value, taskId: '' }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2"
                  >
                    <option value="">{isFr ? '— Optionnel —' : '— Optional —'}</option>
                    {filteredProjects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{isFr ? 'Tâche' : 'Task'}</label>
                  <select
                    value={formRequest.taskId}
                    onChange={(e) => setFormRequest((f) => ({ ...f, taskId: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2"
                    disabled={!formRequest.projectId}
                  >
                    <option value="">{isFr ? '— Optionnel —' : '— Optional —'}</option>
                    {tasks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  type="text"
                  className="border border-slate-300 rounded-lg px-3 py-2"
                  placeholder={isFr ? 'Départ / origine' : 'Origin'}
                  value={formRequest.routeOrigin}
                  onChange={(e) => setFormRequest((f) => ({ ...f, routeOrigin: e.target.value }))}
                />
                <input
                  type="text"
                  className="border border-slate-300 rounded-lg px-3 py-2"
                  placeholder={isFr ? 'Arrivée / destination' : 'Destination'}
                  value={formRequest.routeDestination}
                  onChange={(e) => setFormRequest((f) => ({ ...f, routeDestination: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    {isFr ? 'Début (planning)' : 'Start (planning)'}
                  </label>
                  <input
                    type="datetime-local"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2"
                    value={formRequest.startAt}
                    onChange={(e) => setFormRequest((f) => ({ ...f, startAt: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    {isFr ? 'Fin' : 'End'}
                  </label>
                  <input
                    type="datetime-local"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2"
                    value={formRequest.endAt}
                    onChange={(e) => setFormRequest((f) => ({ ...f, endAt: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {isFr ? 'Ordre de mission (fichier)' : 'Mission order (file)'}
                </label>
                <input
                  type="file"
                  className="text-sm"
                  onChange={(e) => setMissionOrderFile(e.target.files?.[0] ?? null)}
                />
                {missionOrderFile ? (
                  <span className="text-xs text-slate-500 ml-2">{missionOrderFile.name}</span>
                ) : null}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {isFr ? 'Prix indicatif (centimes)' : 'Quoted price (cents)'}
                </label>
                <input
                  type="number"
                  className="w-full md:w-64 border border-slate-300 rounded-lg px-3 py-2"
                  placeholder="0"
                  value={formRequest.quotedPriceCents}
                  onChange={(e) => setFormRequest((f) => ({ ...f, quotedPriceCents: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {isFr ? 'Justification de mission' : 'Mission justification'} *
                </label>
                <textarea
                  required
                  value={formRequest.missionJustification}
                  onChange={(e) => setFormRequest((f) => ({ ...f, missionJustification: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                  rows={3}
                  placeholder={isFr ? 'Objet, lieu, durée…' : 'Purpose, location, duration…'}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {isFr ? 'Approbateur N+1 (si pas de manager RH)' : 'Designated N+1 approver (if no HR manager)'}
                </label>
                <select
                  value={formRequest.designatedApproverProfileId}
                  onChange={(e) => setFormRequest((f) => ({ ...f, designatedApproverProfileId: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                >
                  <option value="">{isFr ? '— Défaut : manager fiche employé —' : '— Default: employee record manager —'}</option>
                  {approverOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {(p.fullName || p.email || p.id).slice(0, 80)}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                placeholder={isFr ? 'Notes (optionnel)' : 'Notes (optional)'}
                value={formRequest.notes}
                onChange={(e) => setFormRequest((f) => ({ ...f, notes: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2"
                rows={2}
              />
              <div className="flex gap-2">
                <button type="submit" className="btn-3d-primary">
                  {isFr ? 'Demander' : 'Request'}
                </button>
                <button type="button" onClick={() => setShowRequestForm(false)} className="btn-3d-secondary">
                  {isFr ? 'Annuler' : 'Cancel'}
                </button>
              </div>
            </form>
          )}
          {requests.length === 0 ? (
            <p className="text-slate-500 text-sm">{isFr ? 'Aucune demande.' : 'No requests.'}</p>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-hidden overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-2 py-2 w-8" />
                    <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">{isFr ? 'Transport' : 'Transport'}</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">{isFr ? 'Lien mission' : 'Mission link'}</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">{isFr ? 'Statut' : 'Status'}</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">{isFr ? 'Paiement' : 'Payment'}</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">{isFr ? 'Date' : 'Date'}</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase">{isFr ? 'Actions' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200">
                  {requests.map((r) => {
                    const v = r.vehicleId ? vehicles.find((ve) => ve.id === r.vehicleId) : undefined;
                    const linkBits = [r.programmeName, r.projectTitle, r.taskTitle].filter(Boolean).join(' · ');
                    const transportTitle =
                      r.transportMode === 'partner'
                        ? [r.partnerCompanyName, r.partnerVehicleLabel].filter(Boolean).join(' — ') ||
                          (r.partnerVehicleId ? r.partnerVehicleId.slice(0, 8) : '—')
                        : v?.name || (r.vehicleId ? r.vehicleId.slice(0, 8) : '—');
                    return (
                      <React.Fragment key={r.id}>
                        <tr>
                          <td className="px-2 py-2 align-top">
                            <button
                              type="button"
                              className="text-emerald-700 text-xs underline"
                              onClick={() => setExpandedRequestId((id) => (id === r.id ? null : r.id))}
                            >
                              {expandedRequestId === r.id ? '−' : '+'}
                            </button>
                          </td>
                          <td className="px-4 py-2 text-sm font-medium align-top">
                            <div className="text-[10px] uppercase text-slate-400">
                              {r.transportMode === 'partner'
                                ? isFr
                                  ? 'Prestataire'
                                  : 'Partner'
                                : isFr
                                  ? 'Interne'
                                  : 'Internal'}
                            </div>
                            <div>{transportTitle}</div>
                            {r.routeOrigin || r.routeDestination ? (
                              <div className="text-xs text-slate-500 mt-1">
                                {r.routeOrigin || '…'} → {r.routeDestination || '…'}
                              </div>
                            ) : null}
                            {r.missionJustification ? (
                              <div className="text-xs text-slate-500 mt-1 max-w-xs line-clamp-2">{r.missionJustification}</div>
                            ) : null}
                          </td>
                          <td className="px-4 py-2 text-xs text-slate-600 align-top max-w-[200px]">{linkBits || '—'}</td>
                          <td className="px-4 py-2 align-top">
                            <span
                              className={`px-2 py-0.5 text-xs rounded-full ${
                                r.status === 'returned'
                                  ? 'bg-green-100 text-green-800'
                                  : r.status === 'allocated'
                                    ? 'bg-blue-100 text-blue-800'
                                    : r.status === 'validated'
                                      ? 'bg-amber-100 text-amber-800'
                                      : r.status === 'rejected'
                                        ? 'bg-red-100 text-red-800'
                                        : r.status === 'pending_n1'
                                          ? 'bg-violet-100 text-violet-800'
                                          : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {statusLabel(r.status)}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-xs text-slate-600 align-top whitespace-nowrap">
                            {paymentStatusLabel(r.paymentStatus, isFr)}
                          </td>
                          <td className="px-4 py-2 text-sm text-slate-500 align-top whitespace-nowrap">
                            {r.requestedAt ? new Date(r.requestedAt).toLocaleDateString('fr-FR') : '—'}
                          </td>
                          <td className="px-4 py-2 text-right text-sm align-top space-y-1">
                            {canActN1On(r) && (
                              <div className="flex flex-wrap justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => void handleUpdateRequestStatus(r.id, 'pending_fleet')}
                                  className="btn-3d-primary text-xs py-1 px-2"
                                >
                                  {isFr ? 'N+1 OK → flotte' : 'N+1 OK → fleet'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleUpdateRequestStatus(r.id, 'rejected')}
                                  className="btn-3d-danger text-xs py-1 px-2"
                                >
                                  {isFr ? 'Rejeter' : 'Reject'}
                                </button>
                              </div>
                            )}
                            {canActFleetOn(r) && r.status === 'pending_fleet' && (
                              <div className="flex flex-wrap justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => void handleUpdateRequestStatus(r.id, 'validated')}
                                  className="btn-3d-primary text-xs py-1 px-2"
                                >
                                  {isFr ? 'Valider (flotte)' : 'Validate (fleet)'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleUpdateRequestStatus(r.id, 'rejected')}
                                  className="btn-3d-danger text-xs py-1 px-2"
                                >
                                  {isFr ? 'Rejeter' : 'Reject'}
                                </button>
                              </div>
                            )}
                            {canActFleetOn(r) && r.status === 'validated' && r.transportMode === 'internal' && (
                              <button
                                type="button"
                                onClick={() => openHandover(r, 'checkout', 'allocated')}
                                className="btn-3d-primary text-xs py-1 px-2"
                              >
                                {isFr ? 'Mise à disposition (constat sortie)' : 'Allocate (checkout)'}
                              </button>
                            )}
                            {canActFleetOn(r) && r.status === 'validated' && r.transportMode === 'partner' && (
                              <button
                                type="button"
                                onClick={() => void handleUpdateRequestStatus(r.id, 'allocated')}
                                className="btn-3d-primary text-xs py-1 px-2"
                              >
                                {isFr ? 'Marquer mis à disposition' : 'Mark allocated'}
                              </button>
                            )}
                            {canActFleetOn(r) && r.status === 'allocated' && r.transportMode === 'internal' && (
                              <button
                                type="button"
                                onClick={() => openHandover(r, 'checkin', 'returned')}
                                className="btn-3d-secondary text-xs py-1 px-2"
                              >
                                {isFr ? 'Retour (constat entrée)' : 'Return (check-in)'}
                              </button>
                            )}
                            {canActFleetOn(r) && r.status === 'allocated' && r.transportMode === 'partner' && (
                              <button
                                type="button"
                                onClick={() => void handleUpdateRequestStatus(r.id, 'returned')}
                                className="btn-3d-secondary text-xs py-1 px-2"
                              >
                                {isFr ? 'Clôturer mission' : 'Close mission'}
                              </button>
                            )}
                          </td>
                        </tr>
                        {expandedRequestId === r.id ? (
                          <tr className="bg-slate-50">
                            <td colSpan={7} className="px-4 py-3 text-sm space-y-4">
                              <div>
                                <div className="text-xs font-semibold text-slate-700 mb-1">
                                  {isFr ? 'Historique des statuts' : 'Status history'}
                                </div>
                                <ul className="text-xs text-slate-600 space-y-1 list-disc pl-4">
                                  {requestTransitions.length === 0 ? (
                                    <li>{isFr ? 'Aucune transition enregistrée (migration récente).' : 'No transitions yet.'}</li>
                                  ) : (
                                    requestTransitions.map((t) => (
                                      <li key={t.id}>
                                        {(t.fromStatus || '—') + ' → ' + t.toStatus}
                                        {' · '}
                                        {t.createdAt ? new Date(t.createdAt).toLocaleString(isFr ? 'fr-FR' : 'en-US') : ''}
                                      </li>
                                    ))
                                  )}
                                </ul>
                              </div>
                              {canEditFleetBilling(r) && expandedRequestId === r.id ? (
                                <div className="border border-slate-200 rounded-lg p-3 bg-white space-y-2 max-w-xl">
                                  <div className="text-xs font-semibold text-slate-700">
                                    {isFr ? 'Tarification & facturation (flotte)' : 'Billing (fleet)'}
                                  </div>
                                  <input
                                    type="number"
                                    className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                                    placeholder={isFr ? 'Montant devis (centimes)' : 'Quote (cents)'}
                                    value={fleetBillingDraft.quotedPriceCents}
                                    onChange={(e) =>
                                      setFleetBillingDraft((f) => ({ ...f, quotedPriceCents: e.target.value }))
                                    }
                                  />
                                  <select
                                    className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                                    value={fleetBillingDraft.paymentStatus}
                                    onChange={(e) =>
                                      setFleetBillingDraft((f) => ({
                                        ...f,
                                        paymentStatus: e.target.value as VehiclePaymentStatus,
                                      }))
                                    }
                                  >
                                    {(
                                      ['not_invoiced', 'pending_payment', 'paid', 'settled'] as VehiclePaymentStatus[]
                                    ).map((ps) => (
                                      <option key={ps} value={ps}>
                                        {paymentStatusLabel(ps, isFr)}
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    type="text"
                                    className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                                    placeholder={isFr ? 'N° facture' : 'Invoice #'}
                                    value={fleetBillingDraft.invoiceNumber}
                                    onChange={(e) =>
                                      setFleetBillingDraft((f) => ({ ...f, invoiceNumber: e.target.value }))
                                    }
                                  />
                                  <textarea
                                    className="w-full border border-slate-300 rounded px-2 py-1 text-xs font-mono"
                                    rows={4}
                                    value={fleetBillingDraft.priceBreakdownJson}
                                    onChange={(e) =>
                                      setFleetBillingDraft((f) => ({ ...f, priceBreakdownJson: e.target.value }))
                                    }
                                  />
                                  <div>
                                    <label className="text-xs text-slate-600">{isFr ? 'Facture (PDF/image)' : 'Invoice file'}</label>
                                    <input
                                      type="file"
                                      className="block text-xs mt-1"
                                      onChange={(e) => setInvoiceFile(e.target.files?.[0] ?? null)}
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    className="btn-3d-primary text-xs"
                                    onClick={() => void submitFleetBillingPatch(r.id)}
                                  >
                                    {isFr ? 'Enregistrer facturation' : 'Save billing'}
                                  </button>
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {showAddCatalogBrand && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-4 shadow-xl space-y-3">
            <h3 className="text-lg font-semibold">{isFr ? 'Nouvelle marque catalogue' : 'New catalog brand'}</h3>
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
              value={newCatalogBrandName}
              onChange={(e) => setNewCatalogBrandName(e.target.value)}
              placeholder={isFr ? 'Nom marque' : 'Brand name'}
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-3d-secondary" onClick={() => setShowAddCatalogBrand(false)}>
                {isFr ? 'Annuler' : 'Cancel'}
              </button>
              <button
                type="button"
                className="btn-3d-primary"
                onClick={async () => {
                  const b = await parcAutoService.createVehicleCatalogBrand(newCatalogBrandName.trim());
                  if (b) {
                    setBrands((prev) => [...prev, b].sort((a, c) => a.name.localeCompare(c.name)));
                    setFormVehicle((f) => ({ ...f, catalogBrandId: b.id }));
                    setShowAddCatalogBrand(false);
                    setNewCatalogBrandName('');
                  }
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddCatalogModel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-4 shadow-xl space-y-3">
            <h3 className="text-lg font-semibold">{isFr ? 'Nouveau modèle catalogue' : 'New catalog model'}</h3>
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
              value={newCatalogModelName}
              onChange={(e) => setNewCatalogModelName(e.target.value)}
              placeholder={isFr ? 'Nom modèle' : 'Model name'}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                className="border border-slate-300 rounded-lg px-3 py-2"
                placeholder={isFr ? 'Année début' : 'Year from'}
                value={newCatalogModelYearFrom}
                onChange={(e) => setNewCatalogModelYearFrom(e.target.value)}
              />
              <input
                type="number"
                className="border border-slate-300 rounded-lg px-3 py-2"
                placeholder={isFr ? 'Année fin (vide=courant)' : 'Year to (empty=current)'}
                value={newCatalogModelYearTo}
                onChange={(e) => setNewCatalogModelYearTo(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-3d-secondary" onClick={() => setShowAddCatalogModel(false)}>
                {isFr ? 'Annuler' : 'Cancel'}
              </button>
              <button
                type="button"
                className="btn-3d-primary"
                onClick={async () => {
                  if (!formVehicle.catalogBrandId) return;
                  const m = await parcAutoService.createVehicleCatalogModel({
                    brandId: formVehicle.catalogBrandId,
                    name: newCatalogModelName.trim(),
                    yearFrom: newCatalogModelYearFrom ? parseInt(newCatalogModelYearFrom, 10) : null,
                    yearTo: newCatalogModelYearTo ? parseInt(newCatalogModelYearTo, 10) : null,
                  });
                  if (m) {
                    setCatalogModels((prev) => [...prev, m].sort((a, c) => a.name.localeCompare(c.name)));
                    setFormVehicle((f) => ({ ...f, catalogModelId: m.id }));
                    setShowAddCatalogModel(false);
                    setNewCatalogModelName('');
                    setNewCatalogModelYearFrom('');
                    setNewCatalogModelYearTo('');
                  }
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

        </div>
      )}

      {handoverModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-4 shadow-xl space-y-3">
            <h3 className="text-lg font-semibold text-slate-900">
              {handoverModal.phase === 'checkout'
                ? isFr
                  ? 'Constat de sortie'
                  : 'Checkout handover'
                : isFr
                  ? 'Constat de retour'
                  : 'Return handover'}
            </h3>
            <input
              type="number"
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
              placeholder={isFr ? 'Odomètre' : 'Odometer'}
              value={handoverForm.odometer ?? ''}
              onChange={(e) =>
                setHandoverForm((f) => ({
                  ...f,
                  odometer: e.target.value === '' ? null : parseInt(e.target.value, 10),
                }))
              }
            />
            <input
              type="number"
              min={0}
              max={100}
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
              placeholder={isFr ? 'Niveau carburant %' : 'Fuel level %'}
              value={handoverForm.fuelLevelPercent ?? ''}
              onChange={(e) =>
                setHandoverForm((f) => ({
                  ...f,
                  fuelLevelPercent: e.target.value === '' ? null : parseInt(e.target.value, 10),
                }))
              }
            />
            <textarea
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
              rows={3}
              placeholder={isFr ? 'État carrosserie, rayures…' : 'Condition, scratches…'}
              value={handoverForm.conditionNotes ?? ''}
              onChange={(e) => setHandoverForm((f) => ({ ...f, conditionNotes: e.target.value || null }))}
            />
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={handoverForm.maintenanceFlag}
                onChange={(e) => setHandoverForm((f) => ({ ...f, maintenanceFlag: e.target.checked }))}
              />
              {isFr ? 'Signaler maintenance / anomalie' : 'Flag maintenance / issue'}
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-3d-secondary" onClick={() => setHandoverModal(null)}>
                {isFr ? 'Annuler' : 'Cancel'}
              </button>
              <button type="button" className="btn-3d-primary" onClick={() => void submitHandover()}>
                {isFr ? 'Enregistrer' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ParcAutoModule;
