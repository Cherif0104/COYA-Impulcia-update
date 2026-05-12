import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalization } from '../contexts/LocalizationContext';
import {
  DriveItem,
  DriveService,
  DriveAccessRequestRow,
  DriveWorkspace,
  DriveAclRow,
  getDriveGdsSchemaFlags,
} from '../services/driveService';
import { fileIconClass, formatDriveSize } from './drive/driveFormat';
import { Language } from '../types';
import ModuleRichHub from './common/ModuleRichHub';

/** Upload navigateur : types courants (images, bureautique, médias, archives, texte). */
const DRIVE_UPLOAD_ACCEPT =
  'image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.json,.xml,.zip,.rar,.7z,.gz,.tar,.webp,.svg,.odt,.ods,.odp,.rtf,.md,.key,.pages,.numbers';

type ViewMode =
  | 'browse'
  | 'shared'
  | 'favorites'
  | 'recent'
  | 'search'
  | 'trash'
  | 'my_requests'
  | 'review_requests'
  | 'gds_archives'
  | 'gds_approved'
  | 'gds_pending';
type LayoutMode = 'grid' | 'list';
type SortKey = 'name' | 'updated_at' | 'created_at';

type WorkspaceNav = 'personal' | { id: string; label: string; root_folder_id: string | null };

const formatSize = formatDriveSize;

const PAGE_SIZE = 10;

function ownerLabelForItem(
  it: DriveItem,
  currentProfileId: string | null,
  ownerMap: Map<string, string>,
  t: (k: string) => string,
) {
  if (it.item_type === 'folder' && it.owner_profile_id && currentProfileId && it.owner_profile_id === currentProfileId) {
    return t('drive_owner_me');
  }
  if (it.item_type === 'folder' && it.owner_profile_id) {
    return ownerMap.get(it.owner_profile_id) ?? it.created_by_name ?? '—';
  }
  return it.created_by_name ?? '—';
}

function workspaceInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function paginationRangeLabel(t: (k: string) => string, from: number, to: number, total: number) {
  return t('drive_pagination_range').replace('{from}', String(from)).replace('{to}', String(to)).replace('{total}', String(total));
}

function clearAccessRequestQueryParams() {
  const url = new URL(window.location.href);
  url.searchParams.delete('accessRequest');
  url.searchParams.delete('access_request');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

const Drive: React.FC = () => {
  const { t, language } = useLocalization();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const newFolderSectionRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewMode>('browse');
  const [workspaceNav, setWorkspaceNav] = useState<WorkspaceNav>('personal');
  const [sharedParentId, setSharedParentId] = useState<string | null>(null);
  const [sharedRoots, setSharedRoots] = useState<DriveItem[]>([]);
  const [favoriteItems, setFavoriteItems] = useState<DriveItem[]>([]);
  const [workspaces, setWorkspaces] = useState<DriveWorkspace[]>([]);
  const [badgeMine, setBadgeMine] = useState(0);
  const [badgeInbox, setBadgeInbox] = useState(0);
  const [childCounts, setChildCounts] = useState<Record<string, number>>({});
  const [aclCounts, setAclCounts] = useState<Record<string, number>>({});
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [ownerMap, setOwnerMap] = useState<Map<string, string>>(new Map());
  const [page, setPage] = useState(1);
  const [genericAccessOpen, setGenericAccessOpen] = useState(false);
  const [genericAccessUuid, setGenericAccessUuid] = useState('');
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [parentId, setParentId] = useState<string | null>(null);
  const [items, setItems] = useState<DriveItem[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<DriveItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderVisibility, setNewFolderVisibility] = useState<'private' | 'org_public'>('private');
  const [trashedItems, setTrashedItems] = useState<DriveItem[]>([]);
  const [recentItems, setRecentItems] = useState<DriveItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<DriveItem[]>([]);
  const [activeItem, setActiveItem] = useState<DriveItem | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [moveTargetFolderId, setMoveTargetFolderId] = useState<string>('__root__');
  const [allFoldersForMove, setAllFoldersForMove] = useState<DriveItem[]>([]);
  const [folderAclCap, setFolderAclCap] = useState<'owner' | 'editor' | 'viewer' | 'admin' | 'none'>('none');
  const [folderAclRows, setFolderAclRows] = useState<DriveAclRow[]>([]);
  const [orgProfiles, setOrgProfiles] = useState<{ id: string; full_name: string | null; email: string }[]>([]);
  const [aclAddProfileId, setAclAddProfileId] = useState('');
  const [aclAddPermission, setAclAddPermission] = useState<'viewer' | 'editor'>('viewer');
  const [layout, setLayout] = useState<LayoutMode>('list');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [clipboard, setClipboard] = useState<{ mode: 'copy' | 'cut'; itemId: string; name: string } | null>(null);
  const [inspectItem, setInspectItem] = useState<DriveItem | null>(null);
  const [myRequests, setMyRequests] = useState<DriveAccessRequestRow[]>([]);
  const [inboxRequests, setInboxRequests] = useState<DriveAccessRequestRow[]>([]);
  const [requestItemNames, setRequestItemNames] = useState<Record<string, string>>({});
  const [accessLinkModal, setAccessLinkModal] = useState<{ itemId: string; name: string; itemType: string } | null>(null);
  const [accessFormPermission, setAccessFormPermission] = useState<'viewer' | 'editor'>('viewer');
  const [accessFormMessage, setAccessFormMessage] = useState('');
  const [accessFormReason, setAccessFormReason] = useState('');
  const [accessFormJustification, setAccessFormJustification] = useState('');
  const [accessFormUrgency, setAccessFormUrgency] = useState<'low' | 'normal' | 'high'>('normal');
  const [accessFormDurationDays, setAccessFormDurationDays] = useState<number | ''>('');
  const [gdsSchemaFlags, setGdsSchemaFlags] = useState(() => getDriveGdsSchemaFlags());

  const workspaceScope = workspaceNav === 'personal' ? 'personal' : workspaceNav.id;
  /** Dossier courant pour création / collage / upload (parcours « Partagés » inclus). */
  const effectiveBrowseParentId =
    view === 'shared' && sharedParentId !== null ? sharedParentId : parentId;
  const [currentProfileId, setCurrentProfileId] = useState<string | null>(null);

  const isGdsGovernanceView = view === 'gds_archives' || view === 'gds_approved' || view === 'gds_pending';
  const navActiveClass = 'bg-blue-50 text-blue-900 ring-1 ring-blue-100';
  const navIdleClass = 'text-slate-700 hover:bg-slate-100';

  const sortItems = useCallback(
    (arr: DriveItem[]) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      const key = sortKey;
      const copy = [...arr];
      copy.sort((a, b) => {
        if (key === 'name') return dir * a.name.localeCompare(b.name);
        const av = new Date((a as any)[key]).getTime();
        const bv = new Date((b as any)[key]).getTime();
        return dir * (av - bv);
      });
      return copy;
    },
    [sortDir, sortKey],
  );

  const listSource = useMemo(() => {
    if (view === 'favorites') return favoriteItems;
    if (view === 'shared' && sharedParentId === null) return sharedRoots;
    if (view === 'gds_archives' || view === 'gds_approved' || view === 'gds_pending') return items;
    return items;
  }, [view, favoriteItems, sharedRoots, sharedParentId, items]);

  const folders = useMemo(() => sortItems(listSource.filter((i) => i.item_type === 'folder')), [listSource, sortItems]);
  const files = useMemo(() => sortItems(listSource.filter((i) => i.item_type !== 'folder')), [listSource, sortItems]);
  const folderById = useMemo(() => {
    const m = new Map<string, DriveItem>();
    allFoldersForMove.forEach((f) => m.set(f.id, f));
    return m;
  }, [allFoldersForMove]);

  const flattenedFolderOptions = useMemo(() => {
    const childrenByParent = new Map<string | null, DriveItem[]>();
    for (const f of allFoldersForMove) {
      const key = f.parent_id ?? null;
      const arr = childrenByParent.get(key) ?? [];
      arr.push(f);
      childrenByParent.set(key, arr);
    }
    for (const [k, arr] of childrenByParent.entries()) {
      arr.sort((a, b) => a.name.localeCompare(b.name));
      childrenByParent.set(k, arr);
    }

    const out: Array<{ id: string; label: string }> = [];
    const walk = (pid: string | null, depth: number) => {
      const children = childrenByParent.get(pid) ?? [];
      for (const c of children) {
        const prefix = depth === 0 ? '' : `${'—'.repeat(Math.min(8, depth))} `;
        out.push({ id: c.id, label: `${prefix}${c.name}` });
        walk(c.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [allFoldersForMove]);

  const sortedBrowseList = useMemo(() => [...folders, ...files], [folders, files]);
  const totalBrowse = sortedBrowseList.length;
  const pageCount = Math.max(1, Math.ceil(totalBrowse / PAGE_SIZE));
  const pagedBrowseItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return sortedBrowseList.slice(start, start + PAGE_SIZE);
  }, [sortedBrowseList, page]);

  const pageFolders = useMemo(() => pagedBrowseItems.filter((i) => i.item_type === 'folder'), [pagedBrowseItems]);
  const pageFiles = useMemo(() => pagedBrowseItems.filter((i) => i.item_type !== 'folder'), [pagedBrowseItems]);

  const isAppleDesktop = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent);

  useEffect(() => {
    void DriveService.getProfileContext().then((c) => {
      if (c.data?.profile?.id) setCurrentProfileId(c.data.profile.id);
    });
  }, []);

  useEffect(() => {
    void DriveService.listWorkspaces().then((r) => {
      if (!r.error) setWorkspaces(r.data);
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    void DriveService.countPendingAccessBadges().then((b) => {
      if (!b.error) {
        setBadgeMine(b.myPending);
        setBadgeInbox(b.inboxPending);
      }
    });
  }, [view, myRequests.length, inboxRequests.length]);

  useEffect(() => {
    const list = ['browse', 'favorites', 'shared'].includes(view) ? listSource : [];
    const folderIds = list.filter((i) => i.item_type === 'folder').map((i) => i.id);
    if (!folderIds.length) {
      setChildCounts({});
      setAclCounts({});
      return;
    }
    let cancelled = false;
    void Promise.all([DriveService.countChildItems(folderIds), DriveService.countAclEntriesForFolders(folderIds)]).then(
      ([c, a]) => {
        if (cancelled) return;
        if (!c.error) setChildCounts(c.data);
        if (!a.error) setAclCounts(a.data);
      },
    );
    void DriveService.listFavoriteItemIds().then((fav) => {
      if (!cancelled && !fav.error) setFavoriteIds(fav.data);
    });
    const ownerIds = [
      ...new Set(list.filter((i) => i.item_type === 'folder' && i.owner_profile_id).map((i) => i.owner_profile_id!)),
    ];
    void DriveService.loadProfileNames(ownerIds as string[]).then((m) => {
      if (!cancelled && !m.error) setOwnerMap(m.data);
    });
    return () => {
      cancelled = true;
    };
  }, [listSource, view, sharedParentId]);

  useEffect(() => {
    setPage(1);
  }, [parentId, workspaceScope, view, sharedParentId, layout, sortKey, sortDir]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      if (view === 'trash') {
        const res = await DriveService.listTrashed();
        if (res.error) throw res.error;
        setTrashedItems(res.data);
        return;
      }
      if (view === 'recent') {
        const res = await DriveService.listRecent(40);
        if (res.error) throw res.error;
        setRecentItems(res.data);
        return;
      }
      if (view === 'search') {
        const res = await DriveService.search(searchQuery, 80);
        if (res.error) throw res.error;
        setSearchResults(res.data);
        return;
      }
      if (view === 'gds_approved') {
        const res = await DriveService.listGovernanceDocuments('approved', 180);
        if (res.error) throw res.error;
        setItems(res.data);
        setBreadcrumbs([]);
        setSharedRoots([]);
        setFavoriteItems([]);
        return;
      }
      if (view === 'gds_pending') {
        const res = await DriveService.listGovernanceDocuments('pending', 180);
        if (res.error) throw res.error;
        setItems(res.data);
        setBreadcrumbs([]);
        setSharedRoots([]);
        setFavoriteItems([]);
        return;
      }
      if (view === 'gds_archives') {
        const res = await DriveService.listGovernanceDocuments('archived', 180);
        if (res.error) throw res.error;
        setItems(res.data);
        setBreadcrumbs([]);
        setSharedRoots([]);
        setFavoriteItems([]);
        return;
      }
      if (view === 'my_requests') {
        const res = await DriveService.listMyAccessRequests();
        if (res.error) throw res.error;
        setMyRequests(res.data);
        const nm = await DriveService.getItemNamesByIds(res.data.map((r) => r.drive_item_id));
        if (!nm.error) setRequestItemNames((prev) => ({ ...prev, ...nm.data }));
        return;
      }
      if (view === 'review_requests') {
        const res = await DriveService.listPendingAccessRequestsToReview();
        if (res.error) throw res.error;
        setInboxRequests(res.data);
        const nm = await DriveService.getItemNamesByIds(res.data.map((r) => r.drive_item_id));
        if (!nm.error) setRequestItemNames((prev) => ({ ...prev, ...nm.data }));
        return;
      }
      if (view === 'favorites') {
        const res = await DriveService.listFavoriteItems(120);
        if (res.error) throw res.error;
        setFavoriteItems(res.data);
        setItems([]);
        setSharedRoots([]);
        return;
      }
      if (view === 'shared') {
        if (!sharedParentId) {
          const res = await DriveService.listSharedFolderRoots(80);
          if (res.error) throw res.error;
          setSharedRoots(res.data);
          setItems([]);
        } else {
          const [listRes, crumbRes, foldersRes] = await Promise.all([
            DriveService.list(sharedParentId, 'personal'),
            DriveService.getBreadcrumbs(sharedParentId),
            DriveService.listAllFolders('personal'),
          ]);
          if (listRes.error) throw listRes.error;
          if (foldersRes.error) throw foldersRes.error;
          setItems(listRes.data);
          setBreadcrumbs(crumbRes.data);
          setAllFoldersForMove(foldersRes.data);
          setSharedRoots([]);
        }
        return;
      }

      const [listRes, crumbRes, foldersRes] = await Promise.all([
        DriveService.list(parentId, workspaceScope),
        DriveService.getBreadcrumbs(parentId),
        DriveService.listAllFolders(workspaceScope),
      ]);
      if (listRes.error) throw listRes.error;
      if (foldersRes.error) throw foldersRes.error;
      setItems(listRes.data);
      setBreadcrumbs(crumbRes.data);
      setAllFoldersForMove(foldersRes.data);
      setSharedRoots([]);
    } catch (e: any) {
      setErrorMsg(String(e?.message ?? e));
    } finally {
      setGdsSchemaFlags(getDriveGdsSchemaFlags());
      setLoading(false);
    }
  }, [parentId, searchQuery, view, workspaceScope, sharedParentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setInspectItem(null);
  }, [parentId]);

  useEffect(() => {
    if (view === 'gds_archives' || view === 'gds_approved' || view === 'gds_pending') setInspectItem(null);
  }, [view]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get('accessRequest') || url.searchParams.get('access_request');
    if (!raw) return;
    let cancelled = false;
    void DriveService.getItemMetaForAccessRequest(raw).then((res) => {
      if (cancelled) return;
      if (res.data) {
        setAccessLinkModal({
          itemId: res.data.id,
          name: res.data.name,
          itemType: res.data.item_type,
        });
      } else if (res.error) {
        setErrorMsg(res.error.message || 'Lien de demande invalide.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeItem || activeItem.item_type !== 'folder') {
      setFolderAclCap('none');
      setFolderAclRows([]);
      setOrgProfiles([]);
      setAclAddProfileId('');
      return;
    }
    let cancelled = false;
    (async () => {
      const cap = await DriveService.getMyFolderCapability(activeItem.id);
      if (cancelled) return;
      setFolderAclCap(cap.level);
      const canManageAcl = cap.level === 'owner' || cap.level === 'admin' || cap.level === 'editor';
      if (!canManageAcl) {
        setFolderAclRows([]);
        setOrgProfiles([]);
        return;
      }
      const [aclRes, profRes] = await Promise.all([
        DriveService.listFolderAcl(activeItem.id),
        DriveService.listOrganizationProfiles(),
      ]);
      if (cancelled) return;
      if (aclRes.error) setFolderAclRows([]);
      else setFolderAclRows(aclRes.data);
      if (profRes.error) setOrgProfiles([]);
      else setOrgProfiles(profRes.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeItem]);

  useEffect(() => {
    if (view !== 'browse') return;
    void DriveService.listAllFolders(workspaceScope).then((res) => {
      if (!res.error) setAllFoldersForMove(res.data);
    });
  }, [view, workspaceScope]);

  const onCreateFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await DriveService.createFolder({
        parentId: effectiveBrowseParentId,
        name,
        workspaceId: workspaceNav === 'personal' ? null : workspaceNav.id,
      });
      if (res.error) throw res.error;
      if (res.data?.id && newFolderVisibility === 'org_public') {
        const visRes = await DriveService.setFolderVisibility(res.data.id, 'org_public');
        if (visRes.error) throw visRes.error;
      }
      setNewFolderName('');
      await refresh();
    } catch (e: any) {
      setErrorMsg(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [newFolderName, newFolderVisibility, effectiveBrowseParentId, refresh, workspaceNav]);

  const onUploadFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList?.length) return;
      const files = Array.from(fileList);
      setLoading(true);
      setErrorMsg(null);
      try {
        for (const file of files) {
          const sz = DriveService.validateUploadSize(file);
          if (!sz.ok) throw (sz as { ok: false; error: Error }).error;
          const res = await DriveService.uploadFile({ parentId: effectiveBrowseParentId, file });
          if (res.error) throw res.error;
        }
        await refresh();
      } catch (e: any) {
        setErrorMsg(String(e?.message ?? e));
      } finally {
        setLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [effectiveBrowseParentId, refresh],
  );

  const onOpenFile = useCallback(async (item: DriveItem) => {
    const res = await DriveService.getDownloadUrl(item);
    if (res.error || !res.data) {
      setErrorMsg(res.error ? String(res.error.message ?? res.error) : 'Lien indisponible');
      return;
    }
    window.open(res.data, '_blank', 'noopener,noreferrer');
  }, []);

  const navigateToFolder = useCallback(
    (folderId: string | null) => {
      if (view === 'shared') {
        setSharedParentId(folderId);
        return;
      }
      if (view !== 'browse') {
        setView('browse');
        setWorkspaceNav('personal');
        setSharedParentId(null);
      }
      setParentId(folderId);
    },
    [view],
  );

  const goPersonalSpace = useCallback(() => {
    setView('browse');
    setWorkspaceNav('personal');
    setSharedParentId(null);
    setParentId(null);
  }, []);

  const pickWorkspace = useCallback((w: DriveWorkspace) => {
    setView('browse');
    setSharedParentId(null);
    setWorkspaceNav({ id: w.id, label: w.name, root_folder_id: w.root_folder_id ?? null });
    setParentId(w.root_folder_id ?? null);
  }, []);

  const onTrash = useCallback(
    async (item: DriveItem) => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const res = await DriveService.trashItem(item.id);
        if (res.error) throw res.error;
        await refresh();
      } catch (e: any) {
        setErrorMsg(String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    },
    [refresh]
  );

  const openActions = useCallback(async (item: DriveItem) => {
    setActiveItem(item);
    setRenameValue(item.name);
    setMoveTargetFolderId(item.parent_id ?? '__root__');
    setAclAddProfileId('');
    setAclAddPermission('viewer');
    const scope = view === 'shared' ? 'personal' : workspaceScope;
    const res = await DriveService.listAllFolders(scope);
    if (!res.error) setAllFoldersForMove(res.data.filter((f) => f.id !== item.id));
  }, [view, workspaceScope]);

  const onCopyToClipboard = useCallback((item: DriveItem) => {
    setClipboard({ mode: 'copy', itemId: item.id, name: item.name });
    setActiveItem(null);
  }, []);

  const onCutToClipboard = useCallback((item: DriveItem) => {
    setClipboard({ mode: 'cut', itemId: item.id, name: item.name });
    setActiveItem(null);
  }, []);

  const onPasteHere = useCallback(async () => {
    const canPaste = view === 'browse' || (view === 'shared' && sharedParentId !== null);
    if (!clipboard || !canPaste) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      if (clipboard.mode === 'cut') {
        const res = await DriveService.moveItem(clipboard.itemId, effectiveBrowseParentId);
        if (res.error) throw res.error;
        setClipboard(null);
      } else {
        const res = await DriveService.copyItem(clipboard.itemId, effectiveBrowseParentId);
        if (res.error) throw res.error;
      }
      await refresh();
    } catch (e: any) {
      setErrorMsg(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [clipboard, effectiveBrowseParentId, refresh, view, sharedParentId]);

  const onAddFolderAcl = useCallback(async () => {
    if (!activeItem || activeItem.item_type !== 'folder' || !aclAddProfileId) return;
    if (activeItem.owner_profile_id && aclAddProfileId === activeItem.owner_profile_id) {
      setErrorMsg('Le propriétaire du dossier a déjà tous les droits.');
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await DriveService.addFolderAcl(activeItem.id, aclAddProfileId, aclAddPermission);
      if (res.error) throw res.error;
      setAclAddProfileId('');
      const aclRes = await DriveService.listFolderAcl(activeItem.id);
      if (!aclRes.error) setFolderAclRows(aclRes.data);
    } catch (e: any) {
      setErrorMsg(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [activeItem, aclAddProfileId, aclAddPermission]);

  const onRemoveFolderAcl = useCallback(
    async (profileId: string) => {
      if (!activeItem || activeItem.item_type !== 'folder') return;
      setLoading(true);
      setErrorMsg(null);
      try {
        const res = await DriveService.removeFolderAcl(activeItem.id, profileId);
        if (res.error) throw res.error;
        const aclRes = await DriveService.listFolderAcl(activeItem.id);
        if (!aclRes.error) setFolderAclRows(aclRes.data);
      } catch (e: any) {
        setErrorMsg(String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    },
    [activeItem],
  );

  const onRename = useCallback(async () => {
    if (!activeItem) return;
    const name = renameValue.trim();
    if (!name) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await DriveService.renameItem(activeItem.id, name);
      if (res.error) throw res.error;
      setActiveItem(null);
      await refresh();
    } catch (e: any) {
      setErrorMsg(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [activeItem, renameValue, refresh]);

  const onMove = useCallback(async () => {
    if (!activeItem) return;
    const target = moveTargetFolderId === '__root__' ? null : moveTargetFolderId;
    if (target === activeItem.id) {
      setErrorMsg('Déplacement impossible: un dossier ne peut pas se contenir lui-même.');
      return;
    }
    if (activeItem.item_type === 'folder' && target) {
      // Anti-boucle: cible ne doit pas être un descendant.
      let cur: string | null = target;
      const guard = new Set<string>();
      while (cur) {
        if (guard.has(cur)) break;
        guard.add(cur);
        if (cur === activeItem.id) {
          setErrorMsg('Déplacement impossible: la destination est dans ce dossier.');
          return;
        }
        cur = folderById.get(cur)?.parent_id ?? null;
      }
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await DriveService.moveItem(activeItem.id, target);
      if (res.error) throw res.error;
      setActiveItem(null);
      await refresh();
    } catch (e: any) {
      setErrorMsg(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [activeItem, folderById, moveTargetFolderId, refresh]);

  const onRestore = useCallback(
    async (item: DriveItem) => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const res = await DriveService.restoreItem(item.id);
        if (res.error) throw res.error;
        await refresh();
      } catch (e: any) {
        setErrorMsg(String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    },
    [refresh]
  );

  const onDeleteForever = useCallback(
    async (item: DriveItem) => {
      const ok = window.confirm('Supprimer définitivement ? Cette action est irréversible.');
      if (!ok) return;
      setLoading(true);
      setErrorMsg(null);
      try {
        const res = await DriveService.deletePermanently(item);
        if (res.error) throw res.error;
        await refresh();
      } catch (e: any) {
        setErrorMsg(String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    },
    [refresh]
  );

  const onDragStart = useCallback((e: React.DragEvent, item: DriveItem) => {
    e.dataTransfer.setData('text/plain', item.id);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const onDropOnFolder = useCallback(
    async (e: React.DragEvent, targetFolder: DriveItem) => {
      e.preventDefault();
      const draggedId = e.dataTransfer.getData('text/plain');
      if (!draggedId || draggedId === targetFolder.id) return;
      // Anti-boucle pour les dossiers: si draggedId est ancêtre de targetFolder.
      let cur: string | null = targetFolder.id;
      const guard = new Set<string>();
      while (cur) {
        if (guard.has(cur)) break;
        guard.add(cur);
        if (cur === draggedId) {
          setErrorMsg('Déplacement impossible: la destination est dans ce dossier.');
          return;
        }
        cur = folderById.get(cur)?.parent_id ?? null;
      }

      setLoading(true);
      setErrorMsg(null);
      try {
        const res = await DriveService.moveItem(draggedId, targetFolder.id);
        if (res.error) throw res.error;
        await refresh();
      } catch (err: any) {
        setErrorMsg(String(err?.message ?? err));
      } finally {
        setLoading(false);
      }
    },
    [folderById, refresh],
  );

  const onDropOnRoot = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const draggedId = e.dataTransfer.getData('text/plain');
      if (!draggedId) return;
      setLoading(true);
      setErrorMsg(null);
      try {
        const res = await DriveService.moveItem(draggedId, null);
        if (res.error) throw res.error;
        await refresh();
      } catch (err: any) {
        setErrorMsg(String(err?.message ?? err));
      } finally {
        setLoading(false);
      }
    },
    [refresh],
  );

  const workspaceHomeClick = useCallback(() => {
    if (workspaceNav === 'personal') setParentId(null);
    else setParentId(workspaceNav.root_folder_id ?? null);
  }, [workspaceNav]);

  const toggleFavoriteItem = useCallback(
    async (it: DriveItem, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const on = !favoriteIds.has(it.id);
      const res = await DriveService.setFavorite(it.id, on);
      if (res.error) {
        setErrorMsg(String((res.error as Error)?.message ?? res.error));
        return;
      }
      const fav = await DriveService.listFavoriteItemIds();
      if (!fav.error) setFavoriteIds(fav.data);
    },
    [favoriteIds],
  );

  const schemaDegraded = !gdsSchemaFlags.workspaceId || !gdsSchemaFlags.documentStatus || !gdsSchemaFlags.category;

  const isFr = language === Language.FR;

  return (
    <>
      <div className="px-4 pt-4 pb-2 max-w-[1920px] mx-auto w-full">
        <ModuleRichHub
          isFr={isFr}
          metrics={[
            {
              labelFr: 'Workspaces',
              labelEn: 'Workspaces',
              value: String(workspaces.length),
              hintFr: 'Espaces GDS visibles',
              hintEn: 'Visible GDS workspaces',
            },
            {
              labelFr: 'Favoris',
              labelEn: 'Favorites',
              value: String(favoriteItems.length),
              hintFr: 'Raccourcis utilisateur',
              hintEn: 'User shortcuts',
            },
            {
              labelFr: 'Vue courante',
              labelEn: 'Current view',
              value: view,
              hintFr: 'Navigation interne Drive',
              hintEn: 'Internal Drive navigation',
            },
            {
              labelFr: 'Schéma GDS',
              labelEn: 'GDS schema',
              value: schemaDegraded ? (isFr ? 'Incomplet' : 'Incomplete') : 'OK',
              hintFr: 'Colonnes requises présentes ?',
              hintEn: 'Required columns present?',
            },
          ]}
          sections={[
            {
              key: 'drive-scope',
              titleFr: 'COYA Drive — périmètre',
              titleEn: 'COYA Drive — scope',
              icon: 'fas fa-folder-open',
              bulletsFr: [
                'Espace personnel, partages, corbeille, demandes d’accès et archives GDS.',
                'Messagerie pour relayer les liens sécurisés vers les dossiers.',
                'Qualité & conformité : catégories et statuts documentaires.',
              ],
              bulletsEn: [
                'Personal space, shares, trash, access requests and GDS archives.',
                'Messaging to relay secure links to folders.',
                'Quality & compliance: document categories and statuses.',
              ],
            },
          ]}
        />
      </div>
      <div className="rounded-2xl border border-slate-200 bg-slate-50 shadow-sm overflow-hidden">
      {schemaDegraded ? (
        <div
          className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          role="status"
        >
          <p className="font-semibold">{t('drive_schema_banner_title')}</p>
          <p className="mt-1 text-amber-900/90 leading-relaxed">{t('drive_schema_banner_body')}</p>
        </div>
      ) : null}
      <div className="flex flex-col lg:flex-row min-h-[calc(100vh-10.5rem)]">
          {/* Navigation contextuelle GDS (mock COYA Drive) */}
          <aside className="w-full lg:w-[17rem] shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 bg-white flex flex-col">
            <div className="p-4 space-y-5 flex flex-col lg:flex-1 lg:min-h-0">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-[#1a73e8] to-[#174ea6] flex items-center justify-center text-white shadow-md">
                  <i className="fas fa-folder-tree text-lg"></i>
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 truncate tracking-tight">{t('coya_drive_title')}</div>
                  <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">GDS</div>
                </div>
              </div>

              <div className="relative">
                <button
                  type="button"
                  className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-[#1a73e8] text-white text-sm font-semibold hover:bg-[#1557b0] transition-colors shadow-sm"
                  onClick={() => setNewMenuOpen((v) => !v)}
                >
                  <i className="fas fa-plus"></i>
                  {t('drive_new_menu')}
                  <i className={`fas fa-chevron-down text-xs transition-transform ${newMenuOpen ? 'rotate-180' : ''}`}></i>
                </button>
                {newMenuOpen ? (
                  <div className="absolute left-0 right-0 mt-1 rounded-xl border border-slate-200 bg-white shadow-lg z-30 py-1 text-sm">
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 text-slate-800"
                      onClick={() => {
                        fileInputRef.current?.click();
                        setNewMenuOpen(false);
                      }}
                    >
                      <i className="fas fa-upload mr-2 text-slate-400"></i>
                      {t('drive_new_upload')}
                    </button>
                  </div>
                ) : null}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={DRIVE_UPLOAD_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    void onUploadFiles(e.target.files);
                    setNewMenuOpen(false);
                  }}
                />
              </div>

              <nav className="space-y-4 lg:flex-1 lg:overflow-y-auto lg:min-h-0 pr-0.5">
                <div>
                  <div className="px-1 mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">{t('drive_nav_primary')}</div>
                  <div className="space-y-0.5">
                    <button
                      type="button"
                      onClick={() => goPersonalSpace()}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        view === 'browse' && workspaceNav === 'personal' ? navActiveClass : navIdleClass
                      }`}
                    >
                      <i className="fas fa-house w-4 text-center text-slate-400"></i>
                      {t('drive_my_space')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setView('shared');
                        setSharedParentId(null);
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        view === 'shared' ? navActiveClass : navIdleClass
                      }`}
                    >
                      <i className="fas fa-user-group w-4 text-center text-slate-400"></i>
                      {t('drive_shared_with_me')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setView('recent')}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        view === 'recent' ? navActiveClass : navIdleClass
                      }`}
                    >
                      <i className="fas fa-clock-rotate-left w-4 text-center text-slate-400"></i>
                      {t('drive_recent')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setView('favorites')}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        view === 'favorites' ? navActiveClass : navIdleClass
                      }`}
                    >
                      <i className="fas fa-star w-4 text-center text-amber-500"></i>
                      {t('drive_favorites_nav')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setView('trash')}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        view === 'trash' ? navActiveClass : navIdleClass
                      }`}
                    >
                      <i className="fas fa-trash w-4 text-center text-slate-400"></i>
                      {t('drive_trash')}
                    </button>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100">
                  <div className="px-1 mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">{t('drive_nav_governance')}</div>
                  <div className="space-y-0.5">
                    <button
                      type="button"
                      onClick={() => setView('gds_pending')}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        view === 'gds_pending' ? navActiveClass : navIdleClass
                      }`}
                    >
                      <i className="fas fa-hourglass-half w-4 text-center text-amber-500"></i>
                      {t('drive_nav_pending')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setView('gds_approved')}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        view === 'gds_approved' ? navActiveClass : navIdleClass
                      }`}
                    >
                      <i className="fas fa-circle-check w-4 text-center text-emerald-600"></i>
                      {t('drive_nav_approved')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setView('gds_archives')}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        view === 'gds_archives' ? navActiveClass : navIdleClass
                      }`}
                    >
                      <i className="fas fa-archive w-4 text-center text-slate-500"></i>
                      {t('drive_nav_archives')}
                    </button>
                  </div>
                </div>
              </nav>

              <div className="pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between px-1 mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{t('drive_workspaces')}</span>
                </div>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {workspaces.length === 0 ? (
                    <p className="text-xs text-slate-500 px-2 py-1">{t('drive_workspaces_empty')}</p>
                  ) : (
                    workspaces.slice(0, 8).map((w, idx) => {
                      const hue = ['bg-blue-600', 'bg-emerald-600', 'bg-violet-600', 'bg-amber-500', 'bg-slate-600'][idx % 5];
                      const active = view === 'browse' && workspaceNav !== 'personal' && workspaceNav.id === w.id;
                      return (
                        <button
                          key={w.id}
                          type="button"
                          onClick={() => pickWorkspace(w)}
                          className={`w-full flex items-center gap-2 px-2 py-2 rounded-xl text-sm text-left transition-colors ${
                            active ? 'bg-blue-50 ring-1 ring-blue-100 text-blue-950' : 'hover:bg-slate-50 text-slate-800'
                          }`}
                        >
                          <span className={`h-8 w-8 rounded-lg ${hue} text-white text-xs font-bold flex items-center justify-center shrink-0`}>
                            {workspaceInitials(w.name)}
                          </span>
                          <span className="truncate font-medium">{w.name}</span>
                        </button>
                      );
                    })
                  )}
                </div>
                {workspaces.length > 8 ? (
                  <button type="button" className="mt-2 text-xs text-blue-600 hover:underline px-2">
                    {t('drive_workspaces_all')}
                  </button>
                ) : null}
              </div>

              <div className="pt-2 border-t border-slate-100 space-y-1 shrink-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-1 mb-1">{t('drive_access_requests_nav')}</div>
                <button
                  type="button"
                  onClick={() => setView('my_requests')}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    view === 'my_requests' ? navActiveClass : navIdleClass
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <i className="fas fa-inbox w-4 text-center text-slate-400"></i>
                    {t('drive_access_mine_short')}
                  </span>
                  {badgeMine > 0 ? (
                    <span className="text-[11px] font-bold bg-[#1a73e8] text-white px-2 py-0.5 rounded-full">{badgeMine}</span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() => setView('review_requests')}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    view === 'review_requests' ? navActiveClass : navIdleClass
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <i className="fas fa-user-check w-4 text-center text-slate-400"></i>
                    {t('drive_access_inbox_short')}
                  </span>
                  {badgeInbox > 0 ? (
                    <span className="text-[11px] font-bold bg-[#1a73e8] text-white px-2 py-0.5 rounded-full">{badgeInbox}</span>
                  ) : null}
                </button>
              </div>

              <div className="mt-auto pt-4 border-t border-slate-100 shrink-0 rounded-xl bg-slate-50 p-3 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600">
                  <span>{t('drive_storage_widget_title')}</span>
                  <span className="text-slate-500 tabular-nums">{t('drive_storage_widget_usage_demo')}</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                  <div className="h-full w-[12%] rounded-full bg-[#1a73e8]" aria-hidden />
                </div>
                <p className="text-[10px] text-slate-500 leading-snug">{t('drive_storage_widget_hint')}</p>
                <span className="text-[11px] font-semibold text-slate-400 cursor-default" title={t('drive_storage_widget_hint')}>
                  {t('drive_storage_manage')}
                </span>
              </div>

              <p className="text-[10px] text-slate-500 leading-snug shrink-0">{t('drive_office_only_hint')}</p>
            </div>
          </aside>

          {/* Main content */}
          <section className="flex-1 min-w-0 flex flex-col bg-white">
            {/* Top bar */}
            <div className="border-b border-slate-100 bg-white px-5 py-4 shrink-0">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <h1 className="text-xl font-bold text-slate-900 tracking-tight">{t('coya_drive_title')}</h1>
                  <p className="text-sm text-slate-500 mt-1 max-w-xl">{t('coya_drive_subtitle')}</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:justify-end">
                  <div className="relative w-full sm:w-[min(100%,380px)]">
                    <i className="fas fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
                    <input
                      ref={searchInputRef}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setView('search');
                      }}
                      placeholder={t('drive_search_placeholder')}
                      className="w-full pl-9 pr-16 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
                      disabled={loading}
                    />
                    <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-sans text-slate-400 border border-slate-200 rounded-md px-1.5 py-0.5 bg-slate-50">
                      {isAppleDesktop ? t('drive_search_mac_k_hint') : t('drive_search_k_hint')}
                    </kbd>
                  </div>
                  <button
                    type="button"
                    onClick={() => setGenericAccessOpen(true)}
                    className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-800 hover:bg-slate-50 transition-colors"
                  >
                    <i className="fas fa-lock text-slate-500"></i>
                    {t('drive_request_access_header')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewMenuOpen((o) => !o)}
                    className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-[#1a73e8] text-white text-sm font-semibold hover:bg-[#1557b0] shadow-sm transition-colors"
                  >
                    <i className="fas fa-plus"></i>
                    {t('drive_new_menu')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void refresh()}
                    disabled={loading}
                    className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                  >
                    <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-rotate-right'}`}></i>
                    {t('drive_refresh')}
                  </button>
                  {(view === 'browse' || (view === 'shared' && sharedParentId !== null)) && clipboard ? (
                    <button
                      type="button"
                      onClick={() => void onPasteHere()}
                      disabled={loading}
                      className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60"
                      title={clipboard.mode === 'cut' ? 'Déplacer ici' : 'Copier ici'}
                    >
                      <i className="fas fa-paste"></i>
                      {t('drive_paste')}
                    </button>
                  ) : null}
                </div>
              </div>

              {(view === 'browse' || view === 'shared' || view === 'favorites' || isGdsGovernanceView) && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm border-t border-slate-100 pt-4">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    {isGdsGovernanceView ? (
                      <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 text-slate-800 font-medium border border-slate-200/80">
                        <i className="fas fa-shield-halved text-[#1a73e8]"></i>
                        {view === 'gds_approved'
                          ? t('drive_gds_context_approved')
                          : view === 'gds_pending'
                            ? t('drive_gds_context_pending')
                            : t('drive_gds_context_archives')}
                      </span>
                    ) : view === 'favorites' ? (
                      <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 text-slate-800 font-medium">
                        <i className="fas fa-star text-amber-500"></i>
                        {t('drive_favorites_nav')}
                      </span>
                    ) : view === 'shared' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setSharedParentId(null)}
                          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-colors ${
                            sharedParentId === null
                              ? 'bg-blue-50 border-blue-200 text-blue-900'
                              : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-800'
                          }`}
                        >
                          <i className="fas fa-user-group"></i>
                          {t('drive_shared_with_me')}
                        </button>
                        {sharedParentId !== null
                          ? breadcrumbs.map((c) => (
                              <React.Fragment key={c.id}>
                                <span className="text-slate-300">/</span>
                                <button
                                  type="button"
                                  onClick={() => navigateToFolder(c.id)}
                                  className="px-3 py-1.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 truncate max-w-[220px]"
                                  title={c.name}
                                >
                                  {c.name}
                                </button>
                              </React.Fragment>
                            ))
                          : null}
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => workspaceHomeClick()}
                          onDragOver={(e) => workspaceNav === 'personal' && e.preventDefault()}
                          onDrop={(e) => workspaceNav === 'personal' && void onDropOnRoot(e)}
                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 transition-colors"
                          title={
                            workspaceNav === 'personal'
                              ? 'Accueil — déposer pour déplacer à la racine personnelle'
                              : t('drive_workspace_no_root')
                          }
                        >
                          <i className="fas fa-house"></i>
                          {workspaceNav === 'personal' ? t('drive_my_space') : workspaceNav.label}
                        </button>
                        {breadcrumbs.map((c) => (
                          <React.Fragment key={c.id}>
                            <span className="text-slate-300">/</span>
                            <button
                              type="button"
                              onClick={() => navigateToFolder(c.id)}
                              className="px-3 py-1.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 truncate max-w-[220px]"
                              title={c.name}
                            >
                              {c.name}
                            </button>
                          </React.Fragment>
                        ))}
                      </>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-xl overflow-hidden border border-slate-200 bg-white">
                      <button
                        type="button"
                        onClick={() => setLayout('list')}
                        className={`px-3 py-1.5 text-xs font-semibold transition-colors ${layout === 'list' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'}`}
                        title={t('drive_view_list')}
                      >
                        <i className="fas fa-list"></i>
                      </button>
                      <button
                        type="button"
                        onClick={() => setLayout('grid')}
                        className={`px-3 py-1.5 text-xs font-semibold transition-colors ${layout === 'grid' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'}`}
                        title={t('drive_view_grid')}
                      >
                        <i className="fas fa-grip"></i>
                      </button>
                    </div>
                    <select
                      value={`${sortKey}:${sortDir}`}
                      onChange={(e) => {
                        const [k, d] = e.target.value.split(':');
                        setSortKey(k as SortKey);
                        setSortDir(d as 'asc' | 'desc');
                      }}
                      className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-800"
                      disabled={loading}
                      title={t('drive_sort')}
                    >
                      <option value="name:asc">{t('drive_sort_name_asc')}</option>
                      <option value="name:desc">{t('drive_sort_name_desc')}</option>
                      <option value="updated_at:desc">{t('drive_sort_updated_desc')}</option>
                      <option value="updated_at:asc">{t('drive_sort_updated_asc')}</option>
                      <option value="created_at:desc">{t('drive_sort_created_desc')}</option>
                      <option value="created_at:asc">{t('drive_sort_created_asc')}</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-2 flex flex-col xl:flex-row gap-6 items-start px-5 pb-8 flex-1">
              <div className="flex-1 min-w-0 w-full space-y-6">
        {errorMsg && (
          <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-red-900">
            <i className="fas fa-triangle-exclamation mr-2"></i>
            {errorMsg}
          </div>
        )}

        {(view === 'browse' || (view === 'shared' && sharedParentId !== null)) && !isGdsGovernanceView && (
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex-1 min-w-[220px]">
              <input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder={t('drive_new_folder') || 'Nouveau dossier…'}
                className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                disabled={loading}
              />
            </div>
            <select
              value={newFolderVisibility}
              onChange={(e) => setNewFolderVisibility(e.target.value as 'private' | 'org_public')}
              className="px-4 py-2 border border-slate-200 rounded-xl bg-white text-sm"
              disabled={loading}
              title={t('drive_folder_visibility') || 'Visibilité'}
            >
              <option value="private">{t('drive_visibility_private') || 'Privé (invitation)'}</option>
              <option value="org_public">{t('drive_visibility_org_public') || 'Public (organisation)'}</option>
            </select>
            <button
              onClick={() => void onCreateFolder()}
              disabled={loading || !newFolderName.trim()}
              className="px-4 py-2 bg-slate-900 text-white rounded-xl font-semibold hover:bg-slate-800 disabled:opacity-60"
            >
              <i className="fas fa-folder-plus mr-2"></i>
              {t('drive_create_folder') || 'Créer'}
            </button>
          </div>
        )}

        {view === 'my_requests' ? (
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 font-semibold text-slate-800">{t('drive_requests_mine')}</div>
            {myRequests.length === 0 ? (
              <div className="p-6 text-sm text-slate-600">{t('drive_access_no_mine')}</div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {myRequests.map((r) => (
                  <li key={r.id} className="px-5 py-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">
                        {requestItemNames[r.drive_item_id] || r.drive_item_id}
                      </div>
                      <div className="text-xs text-slate-500">
                        {t('drive_access_requested_role')}: {r.permission_requested} ·{' '}
                        {new Date(r.created_at).toLocaleString()}
                      </div>
                    </div>
                    <span
                      className={`text-xs font-semibold px-2 py-1 rounded-lg shrink-0 ${
                        r.status === 'pending'
                          ? 'bg-amber-100 text-amber-900'
                          : r.status === 'approved'
                            ? 'bg-emerald-100 text-emerald-900'
                            : 'bg-red-100 text-red-900'
                      }`}
                    >
                      {r.status === 'pending'
                        ? t('drive_access_status_pending')
                        : r.status === 'approved'
                          ? t('drive_access_status_approved')
                          : t('drive_access_status_rejected')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : view === 'review_requests' ? (
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 font-semibold text-slate-800">{t('drive_requests_inbox')}</div>
            {inboxRequests.length === 0 ? (
              <div className="p-6 text-sm text-slate-600">{t('drive_access_no_inbox')}</div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {inboxRequests.map((r) => (
                  <li key={r.id} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">
                        {requestItemNames[r.drive_item_id] || r.drive_item_id}
                      </div>
                      <div className="text-xs text-slate-500">
                        {t('drive_access_requested_role')}: {r.permission_requested}
                        {r.message ? ` · ${r.message}` : ''}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={loading}
                        className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
                        onClick={async () => {
                          setLoading(true);
                          setErrorMsg(null);
                          try {
                            const res = await DriveService.reviewAccessRequest(r.id, 'approved', {
                              reviewedDecision: 'approve',
                            });
                            if (res.error) throw res.error;
                            await refresh();
                          } catch (e: any) {
                            setErrorMsg(String(e?.message ?? e));
                          } finally {
                            setLoading(false);
                          }
                        }}
                      >
                        {t('drive_review_standard')}
                      </button>
                      <button
                        type="button"
                        disabled={loading}
                        className="px-3 py-1.5 rounded-xl bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-50"
                        title="TODO(GDS): révocation automatique à grant_expires_at — cron à brancher"
                        onClick={async () => {
                          setLoading(true);
                          setErrorMsg(null);
                          try {
                            const days = r.requested_duration_days ?? 30;
                            const until = new Date(Date.now() + days * 86400000).toISOString();
                            const res = await DriveService.reviewAccessRequest(r.id, 'approved', {
                              reviewedDecision: 'temporary',
                              grantExpiresAt: until,
                            });
                            if (res.error) throw res.error;
                            await refresh();
                          } catch (e: any) {
                            setErrorMsg(String(e?.message ?? e));
                          } finally {
                            setLoading(false);
                          }
                        }}
                      >
                        {t('drive_temp_access')}
                      </button>
                      <button
                        type="button"
                        disabled={loading}
                        className="px-3 py-1.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                        onClick={async () => {
                          setLoading(true);
                          setErrorMsg(null);
                          try {
                            const res = await DriveService.reviewAccessRequest(r.id, 'rejected', {
                              reviewedDecision: 'reject',
                            });
                            if (res.error) throw res.error;
                            await refresh();
                          } catch (e: any) {
                            setErrorMsg(String(e?.message ?? e));
                          } finally {
                            setLoading(false);
                          }
                        }}
                      >
                        {t('drive_access_reject')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : view === 'trash' ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-200 font-semibold text-gray-800 flex items-center justify-between">
              <span>
                <i className="fas fa-trash mr-2 text-red-500"></i>Corbeille
              </span>
              <button
                onClick={() => void refresh()}
                disabled={loading}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-60"
              >
                <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-rotate-right'} mr-2`}></i>
                Actualiser
              </button>
            </div>
            {trashedItems.length === 0 ? (
              <div className="p-6 text-sm text-gray-600">Corbeille vide.</div>
            ) : (
              <div className="divide-y">
                {trashedItems.map((it) => (
                  <div key={it.id} className="px-5 py-3 flex items-center justify-between hover:bg-gray-50">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <i className={`fas ${it.item_type === 'folder' ? 'fa-folder' : 'fa-file'} text-gray-500`}></i>
                        <span className="truncate font-medium text-gray-900">{it.name}</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 truncate">
                        {it.trashed_at ? `Supprimé le ${new Date(it.trashed_at).toLocaleString('fr-FR')}` : '—'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <button
                        className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                        onClick={() => void onRestore(it)}
                      >
                        Restaurer
                      </button>
                      <button
                        className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
                        onClick={() => void onDeleteForever(it)}
                      >
                        Supprimer définitivement
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : view === 'recent' ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-200 font-semibold text-gray-800 flex items-center justify-between">
              <span>
                <i className="fas fa-clock-rotate-left mr-2 text-indigo-600"></i>Récents
              </span>
              <button
                onClick={() => void refresh()}
                disabled={loading}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-60"
              >
                <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-rotate-right'} mr-2`}></i>
                Actualiser
              </button>
            </div>
            {recentItems.length === 0 ? (
              <div className="p-6 text-sm text-gray-600">Aucun élément récent.</div>
            ) : (
              <div className="divide-y">
                {recentItems.map((it) => (
                  <div key={it.id} className="px-5 py-3 flex items-center justify-between hover:bg-gray-50">
                    <button
                      className="flex-1 text-left min-w-0"
                      onClick={() => {
                        if (it.item_type === 'folder') navigateToFolder(it.id);
                        else void onOpenFile(it);
                      }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <i className={`fas ${it.item_type === 'folder' ? 'fa-folder' : 'fa-file'} text-indigo-600`}></i>
                        <span className="truncate font-medium text-gray-900">{it.name}</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 truncate">
                        {new Date(it.updated_at).toLocaleString('fr-FR')}
                        {it.item_type !== 'folder' ? ` • ${formatSize(it.size_bytes)}` : ''}
                      </div>
                    </button>
                    <button
                      className="ml-3 p-2 text-gray-700 hover:bg-gray-100 rounded"
                      onClick={() => void openActions(it)}
                      title="Actions"
                    >
                      <i className="fas fa-ellipsis-vertical"></i>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : view === 'search' ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-200 font-semibold text-gray-800 flex items-center justify-between">
              <span>
                <i className="fas fa-magnifying-glass mr-2 text-emerald-600"></i>Résultats
              </span>
              <span className="text-sm font-normal text-gray-600">{searchResults.length} élément(s)</span>
            </div>
            {searchResults.length === 0 ? (
              <div className="p-6 text-sm text-gray-600">
                {searchQuery.trim() ? 'Aucun résultat.' : 'Saisissez une recherche.'}
              </div>
            ) : (
              <div className="divide-y">
                {searchResults.map((it) => (
                  <div key={it.id} className="px-5 py-3 flex items-center justify-between hover:bg-gray-50">
                    <button
                      className="flex-1 text-left min-w-0"
                      onClick={() => {
                        if (it.item_type === 'folder') navigateToFolder(it.id);
                        else void onOpenFile(it);
                      }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <i className={`fas ${it.item_type === 'folder' ? 'fa-folder' : 'fa-file'} text-emerald-600`}></i>
                        <span className="truncate font-medium text-gray-900">{it.name}</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 truncate">
                        {it.item_type !== 'folder' ? `${it.mime_type || 'type inconnu'}${it.size_bytes ? ` • ${formatSize(it.size_bytes)}` : ''}` : 'Dossier'}
                      </div>
                    </button>
                    <div className="ml-3 flex items-center gap-2">
                      <button
                        className="p-2 text-gray-700 hover:bg-gray-100 rounded"
                        onClick={() => void openActions(it)}
                        title="Actions"
                      >
                        <i className="fas fa-ellipsis-vertical"></i>
                      </button>
                      <button
                        className="p-2 text-red-600 hover:bg-red-50 rounded"
                        onClick={() => void onTrash(it)}
                        title="Mettre à la corbeille"
                      >
                        <i className="fas fa-trash"></i>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : layout === 'list' ? (
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden transition-shadow">
            <div className="px-5 py-3 border-b border-slate-200 font-semibold text-slate-800 flex flex-wrap items-center justify-between gap-2">
              <span>
                <i className="fas fa-folder-tree mr-2 text-slate-700"></i>
                {t('drive_items')}
              </span>
              <span className="text-xs font-normal text-slate-500">
                {t('drive_elements_count').replace('{count}', String(sortedBrowseList.length))}
              </span>
            </div>
            {sortedBrowseList.length === 0 ? (
              <div className="p-5 text-sm text-slate-600">{t('drive_empty')}</div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-100">
                      <tr>
                        <th className="px-4 py-3">{t('drive_col_name')}</th>
                        <th className="px-4 py-3 hidden sm:table-cell w-44">{t('drive_col_owner')}</th>
                        <th className="px-4 py-3 hidden md:table-cell w-40">{t('drive_col_modified')}</th>
                        <th className="px-4 py-3 hidden lg:table-cell w-28">{t('drive_col_size')}</th>
                        <th className="px-4 py-3 w-28 text-right">{t('actions')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pagedBrowseItems.map((it) => {
                        const sharedOut =
                          it.item_type === 'folder' &&
                          ((aclCounts[it.id] ?? 0) > 0 || it.visibility === 'org_public');
                        const locked = (it.confidentiality_level ?? 1) >= 4;
                        const starred = favoriteIds.has(it.id);
                        return (
                          <tr key={it.id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="px-4 py-3 align-middle">
                              <button
                                type="button"
                                className="flex items-start gap-2 text-left min-w-0 w-full"
                                onClick={() => {
                                  if (it.item_type === 'folder') navigateToFolder(it.id);
                                  else void onOpenFile(it);
                                }}
                                draggable={it.item_type !== 'folder'}
                                onDragStart={(e) => it.item_type !== 'folder' && onDragStart(e, it)}
                              >
                                <span className="shrink-0 mt-0.5">
                                  <i
                                    className={`fas text-lg ${it.item_type === 'folder' ? 'fa-folder text-amber-600' : fileIconClass(it.mime_type, it.name)}`}
                                  ></i>
                                </span>
                                <span className="min-w-0">
                                  <span className="flex flex-wrap items-center gap-1.5 font-medium text-slate-900">
                                    <span className="truncate">{it.name}</span>
                                    {sharedOut ? (
                                      <i className="fas fa-users text-slate-400 text-xs shrink-0" title={t('drive_shared_out')}></i>
                                    ) : null}
                                    {locked ? (
                                      <i className="fas fa-lock text-slate-500 text-xs shrink-0" title={t('drive_confidential')}></i>
                                    ) : null}
                                    {starred ? (
                                      <i className="fas fa-star text-amber-500 text-xs shrink-0" title={t('drive_star')}></i>
                                    ) : null}
                                    {clipboard?.itemId === it.id ? (
                                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                                        {clipboard.mode === 'cut' ? 'Couper' : 'Copié'}
                                      </span>
                                    ) : null}
                                  </span>
                                  {it.item_type === 'folder' ? (
                                    <span className="block text-xs text-slate-500 mt-0.5">
                                      {t('drive_elements_count').replace('{count}', String(childCounts[it.id] ?? 0))}
                                    </span>
                                  ) : null}
                                </span>
                              </button>
                            </td>
                            <td className="px-4 py-3 align-middle hidden sm:table-cell text-slate-600 truncate max-w-[11rem]">
                              {ownerLabelForItem(it, currentProfileId, ownerMap, t)}
                            </td>
                            <td className="px-4 py-3 align-middle hidden md:table-cell text-slate-600 whitespace-nowrap">
                              {new Date(it.updated_at).toLocaleDateString('fr-FR', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </td>
                            <td className="px-4 py-3 align-middle hidden lg:table-cell text-slate-600">
                              {it.item_type === 'folder' ? '—' : formatSize(it.size_bytes) || '—'}
                            </td>
                            <td className="px-4 py-3 align-middle text-right whitespace-nowrap">
                              <button
                                type="button"
                                className="p-2 rounded-lg text-amber-600 hover:bg-amber-50 inline-flex transition-colors"
                                title={t('drive_star')}
                                onClick={(e) => void toggleFavoriteItem(it, e)}
                              >
                                <i className={`fas fa-star${starred ? '' : ' text-slate-300 hover:text-amber-500'}`}></i>
                              </button>
                              <button
                                type="button"
                                className={`p-2 rounded-lg inline-flex transition-colors ${inspectItem?.id === it.id ? 'bg-indigo-100 text-indigo-800' : 'text-slate-600 hover:bg-slate-100'}`}
                                title={t('drive_metadata')}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setInspectItem(it);
                                }}
                              >
                                <i className="fas fa-circle-info"></i>
                              </button>
                              <button
                                type="button"
                                className="p-2 text-slate-700 hover:bg-slate-100 rounded-lg inline-flex transition-colors"
                                onClick={() => void openActions(it)}
                                title="Actions"
                              >
                                <i className="fas fa-ellipsis-vertical"></i>
                              </button>
                              <button
                                type="button"
                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg inline-flex transition-colors"
                                onClick={() => void onTrash(it)}
                                title="Corbeille"
                              >
                                <i className="fas fa-trash"></i>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-3 py-3 px-4 border-t border-slate-100 text-sm text-slate-600">
                  <button
                    type="button"
                    disabled={page <= 1 || loading}
                    className="px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <i className="fas fa-chevron-left"></i>
                  </button>
                  <span>
                    {paginationRangeLabel(
                      t,
                      Math.min((page - 1) * PAGE_SIZE + 1, totalBrowse),
                      Math.min(page * PAGE_SIZE, totalBrowse),
                      totalBrowse,
                    )}
                  </span>
                  <button
                    type="button"
                    disabled={page >= pageCount || loading}
                    className="px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                    onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  >
                    <i className="fas fa-chevron-right"></i>
                  </button>
                  <span className="text-xs text-slate-400">
                    {page}/{pageCount}
                  </span>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Folder "classeur" cards */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="text-sm font-semibold text-slate-900">
                  <i className="fas fa-folder mr-2 text-amber-500"></i>
                  {t('drive_folders') || 'Dossiers'}
                </div>
                <div className="text-xs text-slate-500">
                  {folders.length} dossiers · page {page}/{pageCount}
                </div>
              </div>

              {folders.length === 0 ? (
                <div className="text-sm text-slate-600">{t('drive_no_folders') || 'Aucun dossier.'}</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {pageFolders.map((f) => (
                    <div
                      key={f.id}
                      className="group relative rounded-2xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 shadow-sm hover:shadow-md transition overflow-hidden"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => void onDropOnFolder(e, f)}
                      title="Déposez un fichier ici pour déplacer"
                    >
                      {/* Folder tab (binder-like) */}
                      <div className="absolute top-0 left-4 h-5 w-24 rounded-b-xl bg-amber-200/80 border-x border-b border-amber-300"></div>
                      <button
                        className="w-full text-left p-4 pt-6"
                        onClick={() => navigateToFolder(f.id)}
                        title="Ouvrir"
                      >
                        <div className="flex items-start gap-3">
                          <div className="h-10 w-10 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-700">
                            <i className="fas fa-folder"></i>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-slate-900 truncate">{f.name}</div>
                            <div className="text-xs text-slate-500 truncate">
                              {f.created_by_name ? `Par ${f.created_by_name}` : '—'}
                            </div>
                          </div>
                        </div>
                      </button>
                      <div className="px-4 pb-4 flex items-center justify-between">
                        <div className="text-[11px] text-slate-500 truncate">
                          {new Date(f.updated_at).toLocaleDateString('fr-FR')}
                        </div>
                        <div className="flex items-center gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition">
                          <button
                            type="button"
                            className={`p-2 rounded-lg ${inspectItem?.id === f.id ? 'bg-indigo-100 text-indigo-800' : 'text-slate-700 hover:bg-slate-100'}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setInspectItem(f);
                            }}
                            title={t('drive_metadata')}
                          >
                            <i className="fas fa-circle-info"></i>
                          </button>
                          <button
                            className="p-2 text-slate-700 hover:bg-slate-100 rounded-lg"
                            onClick={() => void openActions(f)}
                            title="Actions"
                          >
                            <i className="fas fa-ellipsis-vertical"></i>
                          </button>
                          <button
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                            onClick={() => void onTrash(f)}
                            title="Mettre à la corbeille"
                          >
                            <i className="fas fa-trash"></i>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Files list */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-200 font-semibold text-slate-800 flex items-center justify-between">
                <span>
                  <i className="fas fa-file mr-2 text-indigo-600"></i>
                  {t('drive_files') || 'Fichiers'}
                </span>
                <span className="text-xs font-normal text-slate-500">{files.length} élément(s)</span>
              </div>
              {files.length === 0 ? (
                <div className="p-5 text-sm text-slate-600">{t('drive_no_files') || 'Aucun fichier.'}</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {pageFiles.map((it) => (
                    <div key={it.id} className="px-5 py-3 flex items-center justify-between hover:bg-slate-50">
                      <button
                        className="flex-1 text-left min-w-0"
                        onClick={() => void onOpenFile(it)}
                        draggable
                        onDragStart={(e) => onDragStart(e, it)}
                        title="Glissez-déposez vers un dossier"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <i className="fas fa-file text-indigo-500"></i>
                          <span className="truncate font-medium text-slate-900">{it.name}</span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 truncate">
                          {(it.mime_type ? it.mime_type : 'type inconnu') + (it.size_bytes ? ` • ${formatSize(it.size_bytes)}` : '')}
                        </div>
                      </button>
                      <div className="ml-3 flex items-center gap-2">
                        <button
                          type="button"
                          className={`p-2 rounded-lg ${inspectItem?.id === it.id ? 'bg-indigo-100 text-indigo-800' : 'text-slate-600 hover:bg-slate-100'}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setInspectItem(it);
                          }}
                          title={t('drive_metadata')}
                        >
                          <i className="fas fa-circle-info"></i>
                        </button>
                        <button
                          className="p-2 text-slate-700 hover:bg-slate-100 rounded-lg"
                          onClick={() => void openActions(it)}
                          title="Actions"
                        >
                          <i className="fas fa-ellipsis-vertical"></i>
                        </button>
                        <button
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                          onClick={() => void onTrash(it)}
                          title="Mettre à la corbeille"
                        >
                          <i className="fas fa-trash"></i>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
              </div>
              {inspectItem && (view === 'browse' || view === 'shared' || view === 'favorites' || isGdsGovernanceView) && (
                <aside className="w-full xl:w-72 shrink-0 rounded-2xl border border-slate-200 bg-white shadow-sm p-4 space-y-4 xl:sticky xl:top-6 transition-all">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-bold text-slate-900">{t('drive_metadata')}</div>
                    <button
                      type="button"
                      className="text-slate-400 hover:text-slate-700"
                      onClick={() => setInspectItem(null)}
                      aria-label={t('drive_access_close')}
                    >
                      <i className="fas fa-times"></i>
                    </button>
                  </div>
                  <div className="text-base font-semibold text-slate-800 break-words">{inspectItem.name}</div>
                  <dl className="text-xs space-y-2 text-slate-600">
                    <div>
                      <dt className="text-slate-400">{t('drive_meta_type')}</dt>
                      <dd>{inspectItem.item_type === 'folder' ? 'Dossier' : inspectItem.mime_type || 'Fichier'}</dd>
                    </div>
                    {inspectItem.item_type !== 'folder' && (
                      <div>
                        <dt className="text-slate-400">{t('drive_meta_size')}</dt>
                        <dd>{formatSize(inspectItem.size_bytes) || '—'}</dd>
                      </div>
                    )}
                    <div>
                      <dt className="text-slate-400">{t('drive_drawer_governance')}</dt>
                      <dd>
                        {(inspectItem.document_status as string) || 'draft'} · Niveau{' '}
                        {inspectItem.confidentiality_level ?? 1}
                        {inspectItem.category ? ` · ${inspectItem.category}` : ''}
                      </dd>
                    </div>
                    {inspectItem.tags && inspectItem.tags.length ? (
                      <div>
                        <dt className="text-slate-400">Tags</dt>
                        <dd>{inspectItem.tags.join(', ')}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt className="text-slate-400">{t('drive_meta_modified')}</dt>
                      <dd>{new Date(inspectItem.updated_at).toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">{t('drive_meta_created')}</dt>
                      <dd>{new Date(inspectItem.created_at).toLocaleString()}</dd>
                    </div>
                    {inspectItem.created_by_name ? (
                      <div>
                        <dt className="text-slate-400">{t('drive_meta_owner_hint')}</dt>
                        <dd>{inspectItem.created_by_name}</dd>
                      </div>
                    ) : null}
                  </dl>
                  <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 text-[11px] text-slate-600 space-y-2">
                    <div className="font-semibold text-slate-700">{t('drive_drawer_governance')}</div>
                    <p>{t('drive_drawer_todo_ocr')}</p>
                    <p>{t('drive_drawer_todo_versions')}</p>
                    <p>{t('drive_drawer_todo_encryption')}</p>
                  </div>
                  <button
                    type="button"
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
                    onClick={() => void openActions(inspectItem)}
                  >
                    {t('drive_open_detail')}
                  </button>
                  {inspectItem.item_type === 'folder' ? (
                    <button
                      type="button"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                      onClick={() => navigateToFolder(inspectItem.id)}
                    >
                      Ouvrir le dossier
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                      onClick={() => void onOpenFile(inspectItem)}
                    >
                      Ouvrir le fichier
                    </button>
                  )}
                </aside>
              )}
            </div>

        {activeItem && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-xl w-full overflow-hidden">
              <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-4 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-lg font-bold truncate">Actions</div>
                  <div className="text-xs text-blue-50 truncate">{activeItem.name}</div>
                </div>
                <button
                  onClick={() => setActiveItem(null)}
                  className="text-white hover:text-gray-200"
                  aria-label="Fermer"
                >
                  <i className="fas fa-times text-xl"></i>
                </button>
              </div>

              <div className="p-6 space-y-5">
                <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 text-sm text-slate-700 space-y-1">
                  <div className="font-semibold text-slate-900">{t('drive_metadata')}</div>
                  <div>
                    {t('drive_meta_type')}:{' '}
                    {activeItem.item_type === 'folder' ? 'Dossier' : activeItem.mime_type || 'Fichier'}
                  </div>
                  {activeItem.item_type !== 'folder' && (
                    <div>
                      {t('drive_meta_size')}: {formatSize(activeItem.size_bytes) || '—'}
                    </div>
                  )}
                  <div className="text-xs text-slate-500">
                    {t('drive_meta_modified')}: {new Date(activeItem.updated_at).toLocaleString()}
                  </div>
                  {activeItem.created_by_name ? (
                    <div className="text-xs text-slate-500">
                      {t('drive_meta_owner_hint')}: {activeItem.created_by_name}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onCopyToClipboard(activeItem)}
                    disabled={loading}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-60"
                    title="Copier (clipboard)"
                  >
                    <i className="fas fa-copy mr-2"></i>
                    {t('drive_copy') || 'Copier'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onCutToClipboard(activeItem)}
                    disabled={loading}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-60"
                    title="Couper (déplacer ensuite)"
                  >
                    <i className="fas fa-scissors mr-2"></i>
                    {t('drive_cut') || 'Couper'}
                  </button>
                  {clipboard && (view === 'browse' || (view === 'shared' && sharedParentId !== null)) ? (
                    <button
                      type="button"
                      onClick={() => void onPasteHere()}
                      disabled={loading}
                      className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-60"
                      title="Coller dans le dossier courant"
                    >
                      <i className="fas fa-paste mr-2"></i>
                      {t('drive_paste') || 'Coller'}
                    </button>
                  ) : null}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Renommer</label>
                  <div className="flex gap-2">
                    <input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      disabled={loading}
                    />
                    <button
                      onClick={() => void onRename()}
                      disabled={loading || !renameValue.trim()}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60"
                    >
                      OK
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Déplacer vers</label>
                  <div className="flex gap-2">
                    <select
                      value={moveTargetFolderId}
                      onChange={(e) => setMoveTargetFolderId(e.target.value)}
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      disabled={loading}
                    >
                      <option value="__root__">Racine</option>
                      {flattenedFolderOptions
                        .filter((o) => o.id !== activeItem.id)
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                    </select>
                    <button
                      onClick={() => void onMove()}
                      disabled={loading}
                      className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-60"
                    >
                      Déplacer
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">Astuce: vous pouvez aussi glisser-déposer un fichier sur un dossier.</p>
                </div>

                {activeItem.item_type === 'folder' && (
                  <div className="border-t border-gray-100 pt-5 space-y-3">
                    <div className="space-y-2">
                      <div className="text-sm font-semibold text-gray-900">{t('drive_folder_visibility') || 'Visibilité du dossier'}</div>
                      <p className="text-xs text-gray-500">{t('drive_folder_visibility_help') || "Privé = seulement invités. Public = visible par toute l'organisation."}</p>
                      <div className="flex flex-wrap gap-2 items-center">
                        <select
                          value={(activeItem.visibility as any) || 'private'}
                          onChange={async (e) => {
                            const v = e.target.value as 'private' | 'org_public';
                            setLoading(true);
                            setErrorMsg(null);
                            try {
                              const res = await DriveService.setFolderVisibility(activeItem.id, v);
                              if (res.error) throw res.error;
                              if (res.data) setActiveItem(res.data);
                              await refresh();
                            } catch (err: any) {
                              setErrorMsg(String(err?.message ?? err));
                            } finally {
                              setLoading(false);
                            }
                          }}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                          disabled={loading || !(folderAclCap === 'owner' || folderAclCap === 'admin' || folderAclCap === 'editor')}
                        >
                          <option value="private">{t('drive_visibility_private') || 'Privé (invitation)'}</option>
                          <option value="org_public">{t('drive_visibility_org_public') || 'Public (organisation)'}</option>
                        </select>
                        {!(folderAclCap === 'owner' || folderAclCap === 'admin' || folderAclCap === 'editor') && (
                          <span className="text-xs text-gray-500">{t('drive_visibility_no_rights') || "Vous n'avez pas le droit de changer la visibilité."}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-gray-900">{t('drive_acl_title')}</div>
                    <p className="text-xs text-gray-500">{t('drive_acl_help')}</p>
                    <p className="text-[11px] text-gray-500">{t('drive_acl_capabilities_hint')}</p>
                    {folderAclCap === 'owner' || folderAclCap === 'admin' || folderAclCap === 'editor' ? (
                      <>
                        <div className="flex flex-wrap gap-2">
                          <select
                            value={aclAddProfileId}
                            onChange={(e) => setAclAddProfileId(e.target.value)}
                            className="flex-1 min-w-[160px] px-3 py-2 border border-gray-300 rounded-lg text-sm"
                            disabled={loading}
                          >
                            <option value="">— {t('assignee') || 'Profil'} —</option>
                            {orgProfiles
                              .filter((p) => p.id !== activeItem.owner_profile_id)
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  {(p.full_name || p.email || p.id).slice(0, 48)}
                                </option>
                              ))}
                          </select>
                          <select
                            value={aclAddPermission}
                            onChange={(e) => setAclAddPermission(e.target.value as 'viewer' | 'editor')}
                            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                            disabled={loading}
                          >
                            <option value="viewer">{t('drive_acl_permission_viewer')}</option>
                            <option value="editor">{t('drive_acl_permission_editor')}</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => void onAddFolderAcl()}
                            disabled={loading || !aclAddProfileId}
                            className="px-3 py-2 bg-slate-800 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
                          >
                            {t('drive_acl_add')}
                          </button>
                        </div>
                        <ul className="text-sm space-y-1 max-h-40 overflow-y-auto">
                          <li className="flex justify-between gap-2 text-gray-700">
                            <span className="truncate">
                              {t('drive_acl_owner')}{' '}
                              {orgProfiles.find((p) => p.id === activeItem.owner_profile_id)?.full_name ||
                                orgProfiles.find((p) => p.id === activeItem.owner_profile_id)?.email ||
                                '—'}
                            </span>
                          </li>
                          {folderAclRows.map((row) => (
                            <li key={row.profile_id} className="flex justify-between gap-2 items-start">
                              <span className="truncate text-gray-800 min-w-0">
                                <span className="font-medium">
                                  {orgProfiles.find((p) => p.id === row.profile_id)?.full_name ||
                                    orgProfiles.find((p) => p.id === row.profile_id)?.email ||
                                    row.profile_id}
                                </span>
                                <span className="block text-[11px] text-gray-500">
                                  {t('drive_capability_summary')}: {DriveService.aclCapabilityLabels(row)}
                                </span>
                              </span>
                              <button
                                type="button"
                                className="text-red-600 text-xs shrink-0 hover:underline"
                                onClick={() => void onRemoveFolderAcl(row.profile_id)}
                              >
                                {t('drive_acl_remove')}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <p className="text-xs text-gray-500">
                        {folderAclCap === 'viewer'
                          ? 'Accès en lecture seule sur ce dossier.'
                          : 'Vous ne gérez pas les invitations sur ce dossier.'}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="px-6 py-4 bg-gray-50 border-t flex justify-end gap-3">
                <button
                  onClick={() => setActiveItem(null)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100"
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        )}

        {genericAccessOpen && (
          <div className="fixed inset-0 z-[58] flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="text-lg font-bold text-slate-900">{t('drive_generic_access_title')}</div>
                <button
                  type="button"
                  className="text-slate-400 hover:text-slate-700"
                  onClick={() => {
                    setGenericAccessOpen(false);
                    setGenericAccessUuid('');
                  }}
                  aria-label={t('drive_access_close')}
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-sm text-slate-600">{t('drive_generic_access_intro')}</p>
                <input
                  value={genericAccessUuid}
                  onChange={(e) => setGenericAccessUuid(e.target.value)}
                  placeholder={t('drive_generic_access_placeholder')}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 font-mono text-sm"
                />
                <button
                  type="button"
                  disabled={loading || !genericAccessUuid.trim()}
                  className="w-full py-2.5 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800 disabled:opacity-50"
                  onClick={async () => {
                    setLoading(true);
                    setErrorMsg(null);
                    try {
                      const raw = genericAccessUuid.trim();
                      const meta = await DriveService.getItemMetaForAccessRequest(raw);
                      if (meta.error) throw meta.error;
                      if (!meta.data) throw new Error('UUID invalide ou accès déjà disponible.');
                      setAccessLinkModal({
                        itemId: meta.data.id,
                        name: meta.data.name,
                        itemType: meta.data.item_type,
                      });
                      setGenericAccessOpen(false);
                      setGenericAccessUuid('');
                    } catch (e: any) {
                      setErrorMsg(String(e?.message ?? e));
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  {t('drive_access_submit')}
                </button>
              </div>
            </div>
          </div>
        )}

        {accessLinkModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="text-lg font-bold text-slate-900">{t('drive_access_modal_title')}</div>
                <button
                  type="button"
                  className="text-slate-400 hover:text-slate-700"
                  onClick={() => {
                    setAccessLinkModal(null);
                    clearAccessRequestQueryParams();
                  }}
                  aria-label={t('drive_access_close')}
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-sm text-slate-600">{t('drive_access_modal_intro')}</p>
                <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
                  <span className="text-slate-500">{t('drive_access_target')}:</span>{' '}
                  <span className="font-semibold text-slate-900">{accessLinkModal.name}</span>
                  <span className="text-slate-400 text-xs ml-2">({accessLinkModal.itemType})</span>
                </div>
                <label className="block text-sm font-medium text-slate-700">{t('drive_access_permission_label')}</label>
                <select
                  value={accessFormPermission}
                  onChange={(e) => setAccessFormPermission(e.target.value as 'viewer' | 'editor')}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm"
                >
                  <option value="viewer">{t('drive_acl_permission_viewer')}</option>
                  <option value="editor">{t('drive_acl_permission_editor')}</option>
                </select>
                <p className="text-[11px] text-slate-500">{t('drive_acl_capabilities_hint')}</p>
                <label className="block text-sm font-medium text-slate-700">Motif</label>
                <input
                  value={accessFormReason}
                  onChange={(e) => setAccessFormReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                  placeholder="Motif court"
                />
                <label className="block text-sm font-medium text-slate-700">Urgence</label>
                <select
                  value={accessFormUrgency}
                  onChange={(e) => setAccessFormUrgency(e.target.value as 'low' | 'normal' | 'high')}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm"
                >
                  <option value="low">low</option>
                  <option value="normal">normal</option>
                  <option value="high">high</option>
                </select>
                <label className="block text-sm font-medium text-slate-700">Durée souhaitée (jours)</label>
                <input
                  type="number"
                  min={1}
                  value={accessFormDurationDays}
                  onChange={(e) => setAccessFormDurationDays(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                  placeholder="ex. 30"
                />
                <label className="block text-sm font-medium text-slate-700">Justification</label>
                <textarea
                  value={accessFormJustification}
                  onChange={(e) => setAccessFormJustification(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                  placeholder="Contexte métier"
                />
                <textarea
                  value={accessFormMessage}
                  onChange={(e) => setAccessFormMessage(e.target.value)}
                  placeholder={t('drive_access_message_placeholder')}
                  rows={3}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                />
                <button
                  type="button"
                  disabled={loading}
                  className="w-full py-2.5 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-50"
                  onClick={async () => {
                    setLoading(true);
                    setErrorMsg(null);
                    try {
                      const res = await DriveService.createAccessRequest({
                        driveItemId: accessLinkModal.itemId,
                        permission: accessFormPermission,
                        message: accessFormMessage.trim() || null,
                        requestReason: accessFormReason.trim() || null,
                        requestedDurationDays:
                          accessFormDurationDays === '' ? null : Math.min(3650, Math.max(1, Number(accessFormDurationDays))),
                        urgency: accessFormUrgency,
                        justification: accessFormJustification.trim() || null,
                      });
                      if (res.error) throw res.error;
                      setAccessLinkModal(null);
                      setAccessFormMessage('');
                      setAccessFormReason('');
                      setAccessFormJustification('');
                      setAccessFormUrgency('normal');
                      setAccessFormDurationDays('');
                      clearAccessRequestQueryParams();
                      setView('my_requests');
                      const mine = await DriveService.listMyAccessRequests();
                      if (!mine.error) setMyRequests(mine.data);
                    } catch (e: any) {
                      setErrorMsg(String(e?.message ?? e));
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  {t('drive_access_submit')}
                </button>
              </div>
            </div>
          </div>
        )}
          </section>
      </div>
    </div>
    </>
  );
};

export default Drive;

