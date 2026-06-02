import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalization } from '../contexts/LocalizationContext';
import { useAuth } from '../contexts/AuthContextSupabase';
import { Language, User } from '../types';
import OrganizationService from '../services/organizationService';
import { FileService } from '../services/fileService';
import * as messagingService from '../services/messagingService';
import { NotificationService } from '../services/notificationService';
import type { NotificationAction, NotificationType } from '../services/notificationService';
import { DataService } from '../services/dataService';
import { supabase } from '../services/supabaseService';
import * as messagingMentions from '../services/messagingMentions';

type ConvKind = 'channel' | 'direct';
type ConvFilter = 'all' | 'unread' | 'favorites';

type MentionRow =
  | { kind: 'broadcast'; token: string; label: string }
  | { kind: 'user'; profile: messagingMentions.MentionProfile };

type Conversation = {
  key: string;
  kind: ConvKind;
  rawId: string;
  title: string;
  description?: string | null;
  membersCount: number;
  memberIds: string[];
  updatedAt?: string;
  channelType?: messagingService.ChatChannelType;
  primaryProfileId?: string | null;
};

const FILTER_PREF_KEY = 'coya_messaging_filter_tab';
const DEEPLINK_KEY = 'coya.messaging.deeplink';
const FAV_KEY = 'coya.messaging.favorites';
const LASTREAD_KEY = 'coya.messaging.lastReadAt';
const REACTIONS_KEY = 'coya.messaging.reactions';
const QUICK_REACTIONS = ['👍', '❤️', '😄', '🎉', '🙏', '👀'];
const CLUSTER_GAP_MIN = 8;
const linkRegex = /https?:\/\/\S+/i;

const COYA_PRIMARY = '#0d7a2b';
const COYA_SECONDARY = '#199c45';

function snippetText(s: string, max = 80): string {
  const t = (s || '').trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function makeConvKey(kind: ConvKind, rawId: string): string {
  return `${kind}:${rawId}`;
}

function parseConvKey(key: string): { kind: ConvKind; rawId: string } | null {
  if (!key) return null;
  const i = key.indexOf(':');
  if (i < 0) return null;
  const kind = key.slice(0, i) as ConvKind;
  const rawId = key.slice(i + 1);
  if ((kind !== 'channel' && kind !== 'direct') || !rawId) return null;
  return { kind, rawId };
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, val: unknown): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(val));
    }
  } catch {
    /* ignore */
  }
}

function getFileExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

function fileMetaFromMessage(m: messagingService.ChatMessage): { name: string; ext: string } | null {
  if (!m.attachmentUrl) return null;
  let name = '';
  const cm = (m.content || '').match(/(?:Fichier|File)\s*:\s*(.+)/i);
  if (cm) name = cm[1].trim();
  if (!name) {
    try {
      const u = new URL(m.attachmentUrl);
      name = decodeURIComponent(u.pathname.split('/').pop() || '');
    } catch {
      name = (m.attachmentUrl.split('/').pop() || '').split('?')[0] || 'fichier';
    }
  }
  const ext = getFileExt(name);
  return { name: name || 'fichier', ext };
}

function fileIconClass(ext: string): { icon: string; tint: string; fg: string } {
  switch (ext) {
    case 'pdf': return { icon: 'fa-file-pdf', tint: '#fee2e2', fg: '#dc2626' };
    case 'xls':
    case 'xlsx':
    case 'csv': return { icon: 'fa-file-excel', tint: '#dcfce7', fg: '#16a34a' };
    case 'doc':
    case 'docx': return { icon: 'fa-file-word', tint: '#dbeafe', fg: '#2563eb' };
    case 'ppt':
    case 'pptx': return { icon: 'fa-file-powerpoint', tint: '#ffedd5', fg: '#ea580c' };
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg': return { icon: 'fa-file-image', tint: '#ede9fe', fg: '#7c3aed' };
    case 'mp3':
    case 'wav':
    case 'm4a': return { icon: 'fa-file-audio', tint: '#cffafe', fg: '#0891b2' };
    case 'mp4':
    case 'mov': return { icon: 'fa-file-video', tint: '#dcfce7', fg: COYA_PRIMARY };
    case 'zip':
    case 'rar':
    case '7z': return { icon: 'fa-file-archive', tint: '#fef3c7', fg: '#a16207' };
    default: return { icon: 'fa-file', tint: '#f1f5f9', fg: '#475569' };
  }
}

function isImageExt(ext: string): boolean {
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext);
}

function formatDayLabel(d: Date, isFr: boolean): string {
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yest = new Date(now.getTime() - 86_400_000);
  const isYest = d.toDateString() === yest.toDateString();
  if (sameDay) return isFr ? "Aujourd'hui" : 'Today';
  if (isYest) return isFr ? 'Hier' : 'Yesterday';
  return d.toLocaleDateString(isFr ? 'fr-FR' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' });
}

function formatRelativeShort(iso: string | undefined, isFr: boolean): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString(isFr ? 'fr-FR' : 'en-US', { hour: '2-digit', minute: '2-digit' });
  }
  const yest = new Date(now.getTime() - 86_400_000);
  if (d.toDateString() === yest.toDateString()) return isFr ? 'Hier' : 'Yest.';
  const within6 = (now.getTime() - d.getTime()) / 86_400_000 < 6;
  if (within6) return d.toLocaleDateString(isFr ? 'fr-FR' : 'en-US', { weekday: 'short' });
  return d.toLocaleDateString(isFr ? 'fr-FR' : 'en-US', { day: 'numeric', month: 'short' });
}

function clusterMeta(
  messages: messagingService.ChatMessage[],
  index: number,
  currentProfileId: string,
) {
  const m = messages[index];
  const prev = index > 0 ? messages[index - 1] : null;
  const d = new Date(m.createdAt);
  const prevD = prev ? new Date(prev.createdAt) : null;
  const showDayDivider = !prevD || d.toDateString() !== prevD.toDateString();
  const isMe = m.senderId === currentProfileId;
  const sameSender = prev && prev.senderId === m.senderId;
  const gapMin =
    prev && (d.getTime() - new Date(prev.createdAt).getTime()) / 60000 > CLUSTER_GAP_MIN;
  const clusterStart = !sameSender || gapMin || showDayDivider;
  return {
    showDayDivider,
    isMe,
    showSenderLabel: !isMe && clusterStart,
    showPeerAvatar: !isMe && clusterStart,
    dense: !clusterStart,
    d,
  };
}

const MessagerieModule: React.FC = () => {
  const { language } = useLocalization();
  const { user: currentUser } = useAuth();
  const isFr = language === Language.FR;
  const dayLocale = isFr ? 'fr-FR' : 'en-US';

  // ---- Préférences UI ----
  const [convFilter, setConvFilter] = useState<ConvFilter>(() => {
    try {
      const raw = localStorage.getItem(FILTER_PREF_KEY);
      if (raw === 'unread' || raw === 'favorites') return raw;
      return 'all';
    } catch {
      return 'all';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(FILTER_PREF_KEY, convFilter);
    } catch {
      /* ignore */
    }
  }, [convFilter]);

  const [showDetails, setShowDetails] = useState(true);
  const [showAdminCreate, setShowAdminCreate] = useState(false);
  const [showMembersEditor, setShowMembersEditor] = useState(false);
  const [showNewDirect, setShowNewDirect] = useState(false);
  const [showReactionPickerFor, setShowReactionPickerFor] = useState<string | null>(null);

  // ---- Données globales ----
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [profiles, setProfiles] = useState<Array<{ id: string; email?: string; fullName?: string; role?: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentProfileId, setCurrentProfileId] = useState<string>('');

  const isAdminMessaging = useMemo(
    () => ['super_administrator', 'administrator'].includes(String(currentUser?.role || '')),
    [currentUser?.role],
  );

  // ---- Conversations ----
  const [channels, setChannels] = useState<messagingService.ChatChannel[]>([]);
  const [threads, setThreads] = useState<messagingService.ChatDirectThread[]>([]);
  const [activeConvKey, setActiveConvKey] = useState<string>('');

  const activeSel = useMemo(() => parseConvKey(activeConvKey), [activeConvKey]);
  const activeChannelId = activeSel?.kind === 'channel' ? activeSel.rawId : '';
  const activeThreadId = activeSel?.kind === 'direct' ? activeSel.rawId : '';

  // ---- Messages de la conversation active ----
  const [channelMessages, setChannelMessages] = useState<messagingService.ChatMessage[]>([]);
  const [activeChannelMembers, setActiveChannelMembers] = useState<string[]>([]);
  const [directMessages, setDirectMessages] = useState<messagingService.ChatMessage[]>([]);

  // ---- Cache « dernier message » par conversation (pour la liste) ----
  const [lastMessageMap, setLastMessageMap] = useState<Record<string, messagingService.ChatMessage | null>>({});

  // ---- Brouillons ----
  const [draftText, setDraftText] = useState<Record<string, string>>({});
  const activeDraft = activeConvKey ? draftText[activeConvKey] || '' : '';
  const setActiveDraft = useCallback(
    (val: string) => {
      if (!activeConvKey) return;
      setDraftText((prev) => ({ ...prev, [activeConvKey]: val }));
    },
    [activeConvKey],
  );

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingVoice, setPendingVoice] = useState<File | null>(null);
  const [sending, setSending] = useState(false);

  // ---- Création canal (admin) ----
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createType, setCreateType] = useState<messagingService.ChatChannelType>('public');
  const [createAudience, setCreateAudience] = useState<'all' | 'manual'>('all');
  const [createMemberIds, setCreateMemberIds] = useState<string[]>([]);
  const [savingChannel, setSavingChannel] = useState(false);

  const [channelMemberDraft, setChannelMemberDraft] = useState<string[]>([]);
  const [savingChannelMembers, setSavingChannelMembers] = useState(false);

  const [directSearch, setDirectSearch] = useState('');
  const [openingThread, setOpeningThread] = useState(false);
  const [listSearch, setListSearch] = useState('');

  // ---- État mention ----
  const messageInputRef = useRef<HTMLInputElement>(null);
  const [draftCursor, setDraftCursor] = useState(0);
  const [mentionIdx, setMentionIdx] = useState(0);

  // ---- Favoris / lus / réactions (localStorage) ----
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set(readJson<string[]>(FAV_KEY, [])));
  const toggleFavorite = useCallback((key: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeJson(FAV_KEY, Array.from(next));
      return next;
    });
  }, []);

  const [lastReadAt, setLastReadAt] = useState<Record<string, string>>(() => readJson<Record<string, string>>(LASTREAD_KEY, {}));
  const markRead = useCallback((key: string) => {
    setLastReadAt((prev) => {
      const cur = prev[key];
      const now = new Date().toISOString();
      if (cur === now) return prev;
      const next = { ...prev, [key]: now };
      writeJson(LASTREAD_KEY, next);
      return next;
    });
  }, []);

  const [reactions, setReactions] = useState<Record<string, Record<string, string[]>>>(() => readJson(REACTIONS_KEY, {}));
  const toggleReaction = useCallback(
    (msgId: string, emoji: string) => {
      if (!currentProfileId) return;
      setReactions((prev) => {
        const forMsg = { ...(prev[msgId] || {}) };
        const list = new Set(forMsg[emoji] || []);
        if (list.has(currentProfileId)) list.delete(currentProfileId);
        else list.add(currentProfileId);
        if (list.size === 0) delete forMsg[emoji];
        else forMsg[emoji] = Array.from(list);
        const next = { ...prev };
        if (Object.keys(forMsg).length === 0) delete next[msgId];
        else next[msgId] = forMsg;
        writeJson(REACTIONS_KEY, next);
        return next;
      });
    },
    [currentProfileId],
  );

  // ---- Refs stables : permettent aux effets long-lived (realtime, init) de lire l'état
  // courant sans figurer dans leurs deps, ce qui évite resubscribes et rechargements complets.
  const isFrRef = useRef(isFr);
  useEffect(() => {
    isFrRef.current = isFr;
  }, [isFr]);

  // ---- Helpers de profils ----
  const userByProfileId = useMemo(() => {
    const m = new Map<string, User>();
    users.forEach((u) => {
      const pid = String((u as any).profileId || u.id || '');
      if (pid) m.set(pid, u);
    });
    return m;
  }, [users]);

  const getDisplayName = useCallback(
    (profileId: string) => {
      const u = userByProfileId.get(profileId);
      if (u) return u.fullName || u.name || u.email || profileId;
      const p = profiles.find((x) => x.id === profileId);
      return p?.fullName || p?.email || profileId;
    },
    [profiles, userByProfileId],
  );

  const getRoleLabel = useCallback(
    (profileId: string) => {
      const p = profiles.find((x) => x.id === profileId);
      const role = String(p?.role || '').replace(/_/g, ' ');
      if (!role) return isFr ? 'Membre' : 'Member';
      return role.replace(/\b\w/g, (c) => c.toUpperCase());
    },
    [profiles, isFr],
  );

  const dedupeIds = (ids: string[]) => Array.from(new Set(ids.filter(Boolean)));

  // ---- Fil DM : libellé / avatar primaire ----
  const threadLabel = useCallback(
    (thread: messagingService.ChatDirectThread) => {
      const others = thread.memberIds.filter((m) => m !== currentProfileId);
      if (others.length === 0 && thread.memberIds.length === 1 && thread.memberIds[0] === currentProfileId) {
        return isFr ? 'Moi — notes / brouillon' : 'Me — notes / draft';
      }
      const names = others.map((id) => userByProfileId.get(id)?.fullName || userByProfileId.get(id)?.email || id);
      return names.join(', ') || (isFr ? 'Conversation' : 'Conversation');
    },
    [currentProfileId, isFr, userByProfileId],
  );

  const threadPrimaryProfile = useCallback(
    (thread: messagingService.ChatDirectThread): string | null => {
      const others = thread.memberIds.filter((m) => m !== currentProfileId);
      return others[0] || thread.memberIds[0] || null;
    },
    [currentProfileId],
  );

  // ---- Liste unifiée des conversations ----
  const conversations = useMemo<Conversation[]>(() => {
    const channelConvs: Conversation[] = channels.map((c) => ({
      key: makeConvKey('channel', c.id),
      kind: 'channel',
      rawId: c.id,
      title: c.name,
      description: c.description || null,
      membersCount: 0,
      memberIds: [],
      updatedAt: c.updatedAt,
      channelType: c.type,
    }));
    const threadConvs: Conversation[] = threads.map((t) => ({
      key: makeConvKey('direct', t.id),
      kind: 'direct',
      rawId: t.id,
      title: threadLabel(t),
      description: null,
      membersCount: t.memberIds.length,
      memberIds: t.memberIds,
      updatedAt: t.updatedAt,
      primaryProfileId: threadPrimaryProfile(t),
    }));
    const combined = [...channelConvs, ...threadConvs];
    combined.sort((a, b) => {
      const ad = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bd = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      if (ad !== bd) return bd - ad;
      return a.title.localeCompare(b.title);
    });
    return combined;
  }, [channels, threads, threadLabel, threadPrimaryProfile]);

  const activeConv = useMemo(() => conversations.find((c) => c.key === activeConvKey) || null, [conversations, activeConvKey]);

  const activeChannel = useMemo(
    () => channels.find((c) => c.id === activeChannelId) || null,
    [channels, activeChannelId],
  );

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) || null,
    [threads, activeThreadId],
  );

  // ---- Compte non lus / dernier message visible ----
  const isConvUnread = useCallback(
    (conv: Conversation) => {
      const lm = lastMessageMap[conv.key];
      if (!lm) return false;
      if (lm.senderId === currentProfileId) return false;
      const last = lastReadAt[conv.key];
      if (!last) return true;
      return new Date(lm.createdAt).getTime() > new Date(last).getTime();
    },
    [lastMessageMap, lastReadAt, currentProfileId],
  );

  const filteredConversations = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    return conversations.filter((c) => {
      if (q) {
        const hay = `${c.title} ${c.description || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (convFilter === 'favorites') return favorites.has(c.key);
      if (convFilter === 'unread') return isConvUnread(c);
      return true;
    });
  }, [conversations, listSearch, convFilter, favorites, isConvUnread]);

  const totalUnread = useMemo(
    () => conversations.reduce((acc, c) => (isConvUnread(c) ? acc + 1 : acc), 0),
    [conversations, isConvUnread],
  );

  // ---- Mentions ----
  const mentionProfiles = useMemo(
    (): messagingMentions.MentionProfile[] => profiles.map((p) => ({ id: p.id, fullName: p.fullName, email: p.email })),
    [profiles],
  );

  const channelMentionScope = useMemo(
    () => mentionProfiles.filter((p) => activeChannelMembers.includes(p.id)),
    [mentionProfiles, activeChannelMembers],
  );

  const directMentionScope = useMemo(() => {
    const ids = activeThread?.memberIds;
    if (ids?.length) return mentionProfiles.filter((p) => ids.includes(p.id));
    return mentionProfiles;
  }, [mentionProfiles, activeThread?.memberIds]);

  const mentionMeta = useMemo(() => {
    if (!activeSel) return null;
    return messagingMentions.getActiveMentionQuery(activeDraft, draftCursor);
  }, [activeSel, activeDraft, draftCursor]);

  const mentionRows = useMemo((): MentionRow[] => {
    if (!mentionMeta || !activeSel) return [];
    const q = mentionMeta.query.toLowerCase();
    if (activeSel.kind === 'channel') {
      const broadcast: MentionRow[] = [];
      const opts = isFr
        ? [
            { token: 'everyone', label: '@everyone — tout le canal' },
            { token: 'tous', label: '@tous — tout le canal' },
            { token: 'canal', label: '@canal — tout le canal' },
          ]
        : [
            { token: 'everyone', label: '@everyone — whole channel' },
            { token: 'channel', label: '@channel — whole channel' },
          ];
      for (const b of opts) {
        if (!q || b.token.startsWith(q) || b.label.toLowerCase().includes(q)) {
          broadcast.push({ kind: 'broadcast', ...b });
        }
      }
      const us = messagingMentions.filterProfilesForMentionPicker(mentionProfiles, mentionMeta.query, {
        onlyAmongIds: activeChannelMembers,
      });
      return [...broadcast, ...us.map((profile) => ({ kind: 'user' as const, profile }))];
    }
    const ids = activeThread?.memberIds?.length ? activeThread.memberIds : undefined;
    const us = messagingMentions.filterProfilesForMentionPicker(mentionProfiles, mentionMeta.query, {
      onlyAmongIds: ids,
    });
    return us.map((profile) => ({ kind: 'user' as const, profile }));
  }, [mentionMeta, activeSel, mentionProfiles, activeChannelMembers, activeThread?.memberIds, isFr]);

  useEffect(() => {
    setMentionIdx(0);
  }, [mentionMeta?.start, mentionMeta?.query, activeConvKey]);

  useEffect(() => {
    setMentionIdx((i) => (mentionRows.length === 0 ? 0 : Math.min(i, mentionRows.length - 1)));
  }, [mentionRows.length]);

  const applyMention = useCallback(
    (row: MentionRow) => {
      if (!activeSel) return;
      const meta = messagingMentions.getActiveMentionQuery(activeDraft, draftCursor);
      if (!meta) return;
      const scope = activeSel.kind === 'channel' ? channelMentionScope : directMentionScope;
      const token = row.kind === 'broadcast' ? row.token : messagingMentions.mentionInsertToken(row.profile, scope);
      const before = activeDraft.slice(0, meta.start);
      const after = activeDraft.slice(draftCursor);
      const insert = `@${token} `;
      const next = before + insert + after;
      const newPos = before.length + insert.length;
      setActiveDraft(next);
      setDraftCursor(newPos);
      requestAnimationFrame(() => {
        const el = messageInputRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(newPos, newPos);
        }
      });
    },
    [activeSel, activeDraft, draftCursor, channelMentionScope, directMentionScope, setActiveDraft],
  );

  const stripMentionFragment = useCallback(() => {
    const meta = messagingMentions.getActiveMentionQuery(activeDraft, draftCursor);
    if (!meta) return;
    const before = activeDraft.slice(0, meta.start);
    const after = activeDraft.slice(draftCursor);
    const next = before + after;
    const newPos = meta.start;
    setActiveDraft(next);
    setDraftCursor(newPos);
    requestAnimationFrame(() => {
      const el = messageInputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(newPos, newPos);
      }
    });
  }, [activeDraft, draftCursor, setActiveDraft]);

  const renderContentWithMentions = useCallback(
    (content: string) => {
      const parts = content.split(/(@[^\s@]+)/g);
      return (
        <>
          {parts.map((part, idx) => {
            if (/^@[^\s@]+$/.test(part)) {
              const raw = part.slice(1);
              let display = part;
              if (messagingMentions.MENTION_UUID_RE.test(raw)) {
                const prof = profiles.find((x) => x.id === raw);
                if (prof?.fullName || prof?.email) display = `@${prof.fullName || prof.email}`;
              }
              return (
                <span
                  key={`${part}-${idx}`}
                  className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[12px] font-semibold"
                  style={{ background: 'rgba(13,122,43,0.12)', color: COYA_PRIMARY }}
                >
                  {display}
                </span>
              );
            }
            return <React.Fragment key={`${part}-${idx}`}>{part}</React.Fragment>;
          })}
        </>
      );
    },
    [profiles],
  );

  const appendMessageUnique = useCallback(
    (setter: React.Dispatch<React.SetStateAction<messagingService.ChatMessage[]>>, next: messagingService.ChatMessage) => {
      setter((prev) => (prev.some((m) => m.id === next.id) ? prev : [...prev, next]));
    },
    [],
  );

  const notifyRecipients = useCallback(
    async (
      recipientIds: string[],
      action: NotificationAction,
      title: string,
      message: string,
      metadata?: Record<string, unknown>,
      notifType: NotificationType = 'info',
    ) => {
      const recipients = dedupeIds(recipientIds).filter((id) => id !== currentProfileId);
      if (recipients.length === 0) return;
      const entityId = metadata?.channelId || metadata?.threadId;
      await NotificationService.notifyUsers(recipients, notifType, 'messagerie', action, title, message, {
        entityType: 'messaging',
        entityId: entityId ? String(entityId) : undefined,
        metadata: { ...metadata, source: 'messagerie' },
      });
    },
    [currentProfileId],
  );

  // ---- Chargements initiaux ----
  const loadChannels = useCallback(async () => {
    if (!organizationId || !currentProfileId) return;
    const list = await messagingService.listChannels({ organizationId, profileId: currentProfileId });
    setChannels(list);
  }, [organizationId, currentProfileId]);

  const loadThreads = useCallback(async () => {
    if (!organizationId || !currentProfileId) return;
    const list = await messagingService.listDirectThreads({ organizationId, profileId: currentProfileId });
    setThreads(list);
  }, [organizationId, currentProfileId]);

  useEffect(() => {
    const init = async () => {
      if (!currentUser) return;
      setLoading(true);
      setError(null);
      try {
        const org = await OrganizationService.getCurrentUserOrganizationId();
        const authUserId = String((currentUser as any).id || currentUser.id || '');
        const { data: profile } = await DataService.getProfile(authUserId);
        let resolvedProfileId = String((currentUser as any)?.profileId || profile?.id || '');
        let orgResolved = org || profile?.organization_id || (currentUser as any).organizationId || null;
        if (!resolvedProfileId && authUserId) {
          try {
            const { data: authData } = await supabase.auth.getUser();
            const uid = authData?.user?.id || authUserId;
            const { data: row } = await supabase.from('profiles').select('id, organization_id').eq('user_id', uid).maybeSingle();
            if (row?.id) {
              resolvedProfileId = String(row.id);
              if (!orgResolved && row.organization_id) orgResolved = row.organization_id;
            }
          } catch {
            /* ignore */
          }
        }
        setCurrentProfileId(resolvedProfileId);
        setOrganizationId(orgResolved);

        const { data: allProfiles } = await DataService.getProfiles();
        const currentOrg = orgResolved;
        const inOrg = (allProfiles || []).filter((p: any) => !currentOrg || p.organization_id === currentOrg);
        setProfiles(
          inOrg.map((p: any) => ({
            id: String(p.id),
            fullName: p.full_name || '',
            email: p.email || '',
            role: p.role || '',
          })),
        );
        const mappedUsers: User[] = inOrg.map((p: any) => ({
          id: p.user_id || p.id,
          profileId: p.id,
          email: p.email || '',
          name: p.full_name || p.email || '',
          fullName: p.full_name || p.email || '',
          role: (p.role || 'user') as any,
          avatar: p.avatar_url || '',
          phone: p.phone_number || '',
          phoneNumber: p.phone_number || '',
          skills: [],
          bio: '',
          location: '',
          website: '',
          linkedinUrl: '',
          githubUrl: '',
          isActive: p.is_active ?? true,
          lastLogin: p.last_login || new Date().toISOString(),
          createdAt: p.created_at || new Date().toISOString(),
          updatedAt: p.updated_at || new Date().toISOString(),
        }));
        setUsers(mappedUsers);
      } catch (e: any) {
        setError(e?.message || (isFrRef.current ? 'Erreur de chargement messagerie.' : 'Messaging loading error.'));
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [currentUser]);

  useEffect(() => {
    loadChannels();
    loadThreads();
  }, [loadChannels, loadThreads]);

  // Auto-sélection de la première conversation après chargement
  useEffect(() => {
    if (activeConvKey) return;
    if (conversations.length === 0) return;
    setActiveConvKey(conversations[0].key);
  }, [conversations, activeConvKey]);

  useEffect(() => {
    setChannelMemberDraft([...activeChannelMembers]);
  }, [activeChannelId, activeChannelMembers]);

  // Deeplinks externes (notifications) : { tab?: 'channels' | 'direct'; channelId?; threadId? }
  useEffect(() => {
    if (!organizationId || !currentProfileId || loading) return;
    try {
      const raw = sessionStorage.getItem(DEEPLINK_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as { ts?: number; tab?: string; channelId?: string; threadId?: string };
      if (!d.ts || Date.now() - d.ts > 120000) {
        sessionStorage.removeItem(DEEPLINK_KEY);
        return;
      }
      if (d.threadId) {
        setActiveConvKey(makeConvKey('direct', String(d.threadId)));
      } else if (d.channelId) {
        setActiveConvKey(makeConvKey('channel', String(d.channelId)));
      }
      sessionStorage.removeItem(DEEPLINK_KEY);
      queueMicrotask(() => messageInputRef.current?.focus());
    } catch {
      try {
        sessionStorage.removeItem(DEEPLINK_KEY);
      } catch {
        /* ignore */
      }
    }
  }, [organizationId, currentProfileId, loading, channels.length, threads.length]);

  // Charger messages + membres du canal actif (avec annulation de course)
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!activeChannelId) {
        setChannelMessages([]);
        setActiveChannelMembers([]);
        return;
      }
      const [msgs, members] = await Promise.all([
        messagingService.listChannelMessages(activeChannelId),
        messagingService.listChannelMembers(activeChannelId),
      ]);
      if (cancelled) return;
      setChannelMessages(msgs);
      setActiveChannelMembers(members);
      const last = msgs[msgs.length - 1] || null;
      setLastMessageMap((prev) => ({ ...prev, [makeConvKey('channel', activeChannelId)]: last }));
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [activeChannelId]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!activeThreadId) {
        setDirectMessages([]);
        return;
      }
      const msgs = await messagingService.listDirectMessages(activeThreadId);
      if (cancelled) return;
      setDirectMessages(msgs);
      const last = msgs[msgs.length - 1] || null;
      setLastMessageMap((prev) => ({ ...prev, [makeConvKey('direct', activeThreadId)]: last }));
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [activeThreadId]);

  // Reset des pièces jointes en attente et de l'UI éphémère lors d'un switch de conversation,
  // pour éviter d'envoyer un fichier sélectionné pour la conversation A dans la conversation B.
  useEffect(() => {
    setPendingFile(null);
    setPendingVoice(null);
    setShowReactionPickerFor(null);
  }, [activeConvKey]);

  // Marquer la conversation active comme lue lorsqu'on l'ouvre / qu'un nouveau message arrive
  useEffect(() => {
    if (!activeConvKey) return;
    markRead(activeConvKey);
  }, [activeConvKey, channelMessages.length, directMessages.length, markRead]);

  // Refs pour que l'effet realtime ne dépende QUE de l'organisation et du profil courant.
  // Sans cela, la souscription se démonte/remonte à chaque switch de conversation,
  // ce qui provoque des flickers, des messages manqués pendant la fenêtre de re-subscription,
  // et des appels postgres_changes redondants.
  const activeChannelIdRef = useRef(activeChannelId);
  const activeThreadIdRef = useRef(activeThreadId);
  const loadChannelsRef = useRef(loadChannels);
  const loadThreadsRef = useRef(loadThreads);
  useEffect(() => {
    activeChannelIdRef.current = activeChannelId;
  }, [activeChannelId]);
  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);
  useEffect(() => {
    loadChannelsRef.current = loadChannels;
  }, [loadChannels]);
  useEffect(() => {
    loadThreadsRef.current = loadThreads;
  }, [loadThreads]);

  // Realtime — souscription unique par couple (organisation, profil).
  useEffect(() => {
    if (!organizationId || !currentProfileId) return;
    const channel = supabase.channel(`messagerie-${organizationId}-${currentProfileId}`);
    channel
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_messages',
          filter: `organization_id=eq.${organizationId}`,
        },
        async (payload: any) => {
          const row = payload?.new ?? payload?.old;
          if (!row) return;
          const currentChannelId = activeChannelIdRef.current;
          const currentThreadId = activeThreadIdRef.current;
          if (row.channel_id && String(row.channel_id) === currentChannelId) {
            const msgs = await messagingService.listChannelMessages(currentChannelId);
            if (activeChannelIdRef.current === currentChannelId) {
              setChannelMessages(msgs);
              const last = msgs[msgs.length - 1] || null;
              setLastMessageMap((prev) => ({ ...prev, [makeConvKey('channel', currentChannelId)]: last }));
            }
          }
          if (row.direct_thread_id && String(row.direct_thread_id) === currentThreadId) {
            const msgs = await messagingService.listDirectMessages(currentThreadId);
            if (activeThreadIdRef.current === currentThreadId) {
              setDirectMessages(msgs);
              const last = msgs[msgs.length - 1] || null;
              setLastMessageMap((prev) => ({ ...prev, [makeConvKey('direct', currentThreadId)]: last }));
            }
          }
          if ((row.channel_id || row.direct_thread_id) && payload?.eventType !== 'DELETE') {
            await Promise.all([loadChannelsRef.current?.(), loadThreadsRef.current?.()]);
            const key = row.channel_id
              ? makeConvKey('channel', String(row.channel_id))
              : makeConvKey('direct', String(row.direct_thread_id));
            setLastMessageMap((prev) => ({
              ...prev,
              [key]: {
                id: String(row.id),
                organizationId: String(row.organization_id),
                channelId: row.channel_id ?? null,
                directThreadId: row.direct_thread_id ?? null,
                senderId: String(row.sender_id),
                content: row.content || '',
                messageType: (row.message_type || 'text') as messagingService.ChatMessageType,
                attachmentUrl: row.attachment_url ?? null,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
              },
            }));
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_channels',
          filter: `organization_id=eq.${organizationId}`,
        },
        async () => {
          await loadChannelsRef.current?.();
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_direct_threads',
          filter: `organization_id=eq.${organizationId}`,
        },
        async () => {
          await loadThreadsRef.current?.();
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_direct_members',
          filter: `profile_id=eq.${currentProfileId}`,
        },
        async () => {
          await loadThreadsRef.current?.();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, currentProfileId]);

  // ---- Création canal admin ----
  const handleCreateChannel = async () => {
    if (!organizationId || !currentProfileId || !createName.trim()) return;
    setSavingChannel(true);
    setError(null);
    try {
      const allMembers = users.map((u) => String((u as any).profileId || u.id || '')).filter(Boolean);
      const memberIds = createAudience === 'all' ? allMembers : createMemberIds;
      const created = await messagingService.createChannel({
        organizationId,
        createdById: currentProfileId,
        name: createName.trim(),
        description: createDesc.trim(),
        type: createType,
        memberIds,
      });
      setCreateName('');
      setCreateDesc('');
      setCreateType('public');
      setCreateAudience('all');
      setCreateMemberIds([]);
      setShowAdminCreate(false);
      await loadChannels();
      setActiveConvKey(makeConvKey('channel', created.id));
      await notifyRecipients(
        memberIds,
        'created',
        isFr ? 'Nouveau canal créé' : 'New channel created',
        isFr ? `Vous avez été ajouté au canal « ${created.name} ».` : `You were added to channel "${created.name}".`,
        { channelId: created.id, channelName: created.name },
        'info',
      );
    } catch (e: any) {
      const message = String(e?.message || '');
      if (message.toLowerCase().includes('duplicate') || String(e?.code || '') === '23505') {
        setError(isFr ? 'Un canal avec ce nom existe déjà.' : 'A channel with this name already exists.');
      } else {
        setError(e?.message || (isFr ? 'Impossible de créer le canal.' : 'Unable to create channel.'));
      }
    } finally {
      setSavingChannel(false);
    }
  };

  const handleRenameActiveChannel = async () => {
    if (!activeChannel) return;
    const name = prompt(isFr ? 'Nouveau nom du canal' : 'New channel name', activeChannel.name);
    if (!name || !name.trim()) return;
    await messagingService.updateChannel(activeChannel.id, { name: name.trim() });
    await loadChannels();
  };

  const handleArchiveActiveChannel = async () => {
    if (!activeChannel) return;
    if (!confirm(isFr ? 'Archiver ce canal ?' : 'Archive this channel?')) return;
    await messagingService.archiveChannel(activeChannel.id);
    await loadChannels();
    setActiveConvKey('');
  };

  const persistChannelMembers = async () => {
    if (!activeChannelId || !isAdminMessaging) return;
    setSavingChannelMembers(true);
    setError(null);
    try {
      const withCreator = dedupeIds([currentProfileId, ...channelMemberDraft]);
      await messagingService.setChannelMembers(activeChannelId, withCreator);
      const members = await messagingService.listChannelMembers(activeChannelId);
      setActiveChannelMembers(members);
      setShowMembersEditor(false);
    } catch (e: any) {
      setError(e?.message || (isFr ? 'Impossible de mettre à jour les membres.' : 'Could not update members.'));
    } finally {
      setSavingChannelMembers(false);
    }
  };

  // ---- Envoi unifié ----
  const sendActiveText = useCallback(async () => {
    if (!activeSel || !organizationId || !currentProfileId) return;
    const content = activeDraft.trim();
    if (!content) return;
    const sentSel = activeSel;
    setSending(true);
    setError(null);
    try {
      const messageType: messagingService.ChatMessageType = linkRegex.test(content) ? 'link' : 'text';
      if (sentSel.kind === 'channel') {
        const created = await messagingService.sendChannelMessage({
          organizationId,
          channelId: sentSel.rawId,
          senderId: currentProfileId,
          content,
          messageType,
        });
        if (activeChannelIdRef.current === sentSel.rawId) {
          appendMessageUnique(setChannelMessages, created);
        }
        setLastMessageMap((prev) => ({ ...prev, [makeConvKey('channel', sentSel.rawId)]: created }));
        setActiveDraft('');
        const broadcast = messagingMentions.isBroadcastMention(content);
        const mentionIds = messagingMentions.extractMentionedProfileIds(content, mentionProfiles, {
          onlyAmongMemberIds: activeChannelMembers,
        });
        const others = activeChannelMembers.filter((id) => id !== currentProfileId);
        const snip = snippetText(content);
        const senderLabel = getDisplayName(currentProfileId);
        const chName = activeChannel?.name || (isFr ? 'canal' : 'channel');
        const baseMeta = { channelId: sentSel.rawId, channelName: chName, messageId: created.id };
        if (broadcast) {
          await notifyRecipients(
            others,
            'updated',
            isFr ? `Canal « ${chName} » — @tous` : `Channel "${chName}" — @all`,
            `${senderLabel}: ${snip}`,
            { ...baseMeta, kind: 'channel_broadcast' },
            'info',
          );
        } else {
          const mentioned = mentionIds.filter((id) => id !== currentProfileId && activeChannelMembers.includes(id));
          const mentionSet = new Set(mentioned);
          const rest = others.filter((id) => !mentionSet.has(id));
          if (mentioned.length > 0) {
            await notifyRecipients(
              mentioned,
              'requested_changes',
              isFr ? 'Mention dans un canal' : 'Mention in channel',
              isFr ? `${senderLabel} dans #${chName} : ${snip}` : `${senderLabel} in #${chName}: ${snip}`,
              { ...baseMeta, kind: 'mention' },
              'warning',
            );
          }
          if (rest.length > 0) {
            await notifyRecipients(
              rest,
              'updated',
              isFr ? 'Nouveau message sur le canal' : 'New channel message',
              isFr ? `#${chName} — ${senderLabel} : ${snip}` : `#${chName} — ${senderLabel}: ${snip}`,
              { ...baseMeta, kind: 'channel_message' },
              'info',
            );
          }
        }
      } else {
        const created = await messagingService.sendDirectMessage({
          organizationId,
          directThreadId: sentSel.rawId,
          senderId: currentProfileId,
          content,
          messageType,
        });
        if (activeThreadIdRef.current === sentSel.rawId) {
          appendMessageUnique(setDirectMessages, created);
        }
        setLastMessageMap((prev) => ({ ...prev, [makeConvKey('direct', sentSel.rawId)]: created }));
        setActiveDraft('');
        const recipients = activeThread?.memberIds || [];
        const mentionInThread = messagingMentions.extractMentionedProfileIds(content, mentionProfiles, {
          onlyAmongMemberIds: recipients,
        });
        const others = recipients.filter((id) => id !== currentProfileId);
        const mentionHit = others.some((id) => mentionInThread.includes(id));
        await notifyRecipients(
          recipients,
          mentionHit ? 'requested_changes' : 'updated',
          mentionHit
            ? isFr
              ? 'Mention — message direct'
              : 'Mention — direct message'
            : isFr
              ? 'Nouveau message direct'
              : 'New direct message',
          `${getDisplayName(currentProfileId)}: ${snippetText(content)}`,
          { threadId: sentSel.rawId, messageId: created.id, kind: 'direct_text' },
          mentionHit ? 'warning' : 'info',
        );
      }
    } catch (e: any) {
      setError(
        isFr
          ? `Envoi impossible : ${String(e?.message || e || 'erreur')}.`
          : `Could not send: ${String(e?.message || e || 'error')}.`,
      );
    } finally {
      setSending(false);
    }
  }, [
    activeSel,
    organizationId,
    currentProfileId,
    activeDraft,
    setActiveDraft,
    appendMessageUnique,
    notifyRecipients,
    getDisplayName,
    mentionProfiles,
    activeChannelMembers,
    activeChannel?.name,
    activeThread?.memberIds,
    isFr,
  ]);

  const sendActiveFile = useCallback(async () => {
    if (!activeSel || !organizationId || !currentProfileId || !pendingFile) return;
    const sentSel = activeSel;
    const fileToSend = pendingFile;
    const fileName = fileToSend.name;
    setSending(true);
    setError(null);
    try {
      if (sentSel.kind === 'channel') {
        const path = `messaging/channels/${sentSel.rawId}/${Date.now()}-${fileName}`;
        const { data } = await FileService.uploadFile('documents', fileToSend, path);
        const created = await messagingService.sendChannelMessage({
          organizationId,
          channelId: sentSel.rawId,
          senderId: currentProfileId,
          content: `${isFr ? 'Fichier' : 'File'}: ${fileName}`,
          messageType: 'link',
          attachmentUrl: data?.url || null,
        });
        if (activeChannelIdRef.current === sentSel.rawId) {
          appendMessageUnique(setChannelMessages, created);
        }
        setLastMessageMap((prev) => ({ ...prev, [makeConvKey('channel', sentSel.rawId)]: created }));
        await notifyRecipients(
          activeChannelMembers,
          'updated',
          isFr ? 'Nouveau fichier canal' : 'New channel file',
          isFr
            ? `${getDisplayName(currentProfileId)} — fichier dans « ${activeChannel?.name || 'canal'} » : ${fileName}`
            : `${getDisplayName(currentProfileId)} — file in "${activeChannel?.name || 'channel'}": ${fileName}`,
          { channelId: sentSel.rawId, messageId: created.id, kind: 'channel_file' },
          'info',
        );
      } else {
        const path = `messaging/direct/${sentSel.rawId}/${Date.now()}-${fileName}`;
        const { data } = await FileService.uploadFile('documents', fileToSend, path);
        const created = await messagingService.sendDirectMessage({
          organizationId,
          directThreadId: sentSel.rawId,
          senderId: currentProfileId,
          content: `${isFr ? 'Fichier' : 'File'}: ${fileName}`,
          messageType: 'link',
          attachmentUrl: data?.url || null,
        });
        if (activeThreadIdRef.current === sentSel.rawId) {
          appendMessageUnique(setDirectMessages, created);
        }
        setLastMessageMap((prev) => ({ ...prev, [makeConvKey('direct', sentSel.rawId)]: created }));
        const recipients = activeThread?.memberIds || [];
        await notifyRecipients(
          recipients,
          'updated',
          isFr ? 'Nouveau fichier direct' : 'New direct file',
          `${getDisplayName(currentProfileId)} — ${fileName}`,
          { threadId: sentSel.rawId, messageId: created.id, kind: 'direct_file' },
          'info',
        );
      }
      setPendingFile(null);
    } catch (e: any) {
      setError(isFr ? `Envoi fichier impossible : ${String(e?.message || e)}` : `File send failed: ${String(e?.message || e)}`);
    } finally {
      setSending(false);
    }
  }, [
    activeSel,
    organizationId,
    currentProfileId,
    pendingFile,
    appendMessageUnique,
    notifyRecipients,
    getDisplayName,
    activeChannelMembers,
    activeChannel?.name,
    activeThread?.memberIds,
    isFr,
  ]);

  const sendActiveVoice = useCallback(async () => {
    if (!activeSel || !organizationId || !currentProfileId || !pendingVoice) return;
    const sentSel = activeSel;
    const voiceToSend = pendingVoice;
    setSending(true);
    setError(null);
    try {
      if (sentSel.kind === 'channel') {
        const path = `messaging/channels/${sentSel.rawId}/${Date.now()}-${voiceToSend.name}`;
        const { data } = await FileService.uploadFile('documents', voiceToSend, path);
        const created = await messagingService.sendChannelMessage({
          organizationId,
          channelId: sentSel.rawId,
          senderId: currentProfileId,
          content: isFr ? 'Message vocal' : 'Voice message',
          messageType: 'voice',
          attachmentUrl: data?.url || null,
        });
        if (activeChannelIdRef.current === sentSel.rawId) {
          appendMessageUnique(setChannelMessages, created);
        }
        setLastMessageMap((prev) => ({ ...prev, [makeConvKey('channel', sentSel.rawId)]: created }));
        await notifyRecipients(
          activeChannelMembers,
          'updated',
          isFr ? 'Nouveau vocal canal' : 'New channel voice message',
          isFr
            ? `${getDisplayName(currentProfileId)} — vocal dans « ${activeChannel?.name || 'canal'} »`
            : `${getDisplayName(currentProfileId)} — voice in "${activeChannel?.name || 'channel'}"`,
          { channelId: sentSel.rawId, messageId: created.id, kind: 'channel_voice' },
          'info',
        );
      } else {
        const path = `messaging/direct/${sentSel.rawId}/${Date.now()}-${voiceToSend.name}`;
        const { data } = await FileService.uploadFile('documents', voiceToSend, path);
        const created = await messagingService.sendDirectMessage({
          organizationId,
          directThreadId: sentSel.rawId,
          senderId: currentProfileId,
          content: isFr ? 'Message vocal' : 'Voice message',
          messageType: 'voice',
          attachmentUrl: data?.url || null,
        });
        if (activeThreadIdRef.current === sentSel.rawId) {
          appendMessageUnique(setDirectMessages, created);
        }
        setLastMessageMap((prev) => ({ ...prev, [makeConvKey('direct', sentSel.rawId)]: created }));
        const recipients = activeThread?.memberIds || [];
        await notifyRecipients(
          recipients,
          'updated',
          isFr ? 'Nouveau vocal direct' : 'New direct voice message',
          `${getDisplayName(currentProfileId)} — ${isFr ? 'message vocal' : 'voice message'}`,
          { threadId: sentSel.rawId, messageId: created.id, kind: 'direct_voice' },
          'info',
        );
      }
      setPendingVoice(null);
    } catch (e: any) {
      setError(isFr ? `Envoi vocal impossible : ${String(e?.message || e)}` : `Voice send failed: ${String(e?.message || e)}`);
    } finally {
      setSending(false);
    }
  }, [
    activeSel,
    organizationId,
    currentProfileId,
    pendingVoice,
    appendMessageUnique,
    notifyRecipients,
    getDisplayName,
    activeChannelMembers,
    activeChannel?.name,
    activeThread?.memberIds,
    isFr,
  ]);

  // ---- Ouverture d'un fil DM depuis le picker ----
  const openDirectThread = async (otherProfileId: string) => {
    setError(null);
    if (!organizationId) {
      setError(isFr ? 'Organisation introuvable. Vérifiez votre profil.' : 'Organization not found. Check your profile.');
      return;
    }
    if (!currentProfileId) {
      setError(
        isFr
          ? 'Profil utilisateur introuvable. Reconnectez-vous ou contactez un administrateur.'
          : 'User profile not found. Sign in again or contact an administrator.',
      );
      return;
    }
    setOpeningThread(true);
    try {
      const thread = await messagingService.createOrGetDirectThread({
        organizationId,
        createdById: currentProfileId,
        memberIds: [currentProfileId, otherProfileId],
      });
      await loadThreads();
      setActiveConvKey(makeConvKey('direct', thread.id));
      setShowNewDirect(false);
      setDirectSearch('');
    } catch (e: any) {
      const msg = String(e?.message || e?.error_description || e || '');
      setError(
        msg
          ? isFr
            ? `Impossible d’ouvrir la conversation : ${msg}`
            : `Could not open conversation: ${msg}`
          : isFr
            ? 'Impossible d’ouvrir la conversation directe.'
            : 'Could not open direct conversation.',
      );
    } finally {
      setOpeningThread(false);
    }
  };

  const availableDirectUsers = useMemo(() => {
    const q = directSearch.trim().toLowerCase();
    const matches = (u: User) => {
      if (!q) return true;
      const n = String(u.fullName || u.name || '').toLowerCase();
      const e = String(u.email || '').toLowerCase();
      return n.includes(q) || e.includes(q);
    };
    return users
      .filter(matches)
      .sort((a, b) => {
        const ap = String((a as any).profileId || a.id);
        const bp = String((b as any).profileId || b.id);
        const aSelf = ap === currentProfileId;
        const bSelf = bp === currentProfileId;
        if (aSelf !== bSelf) return aSelf ? -1 : 1;
        return String(a.fullName || a.email || '').localeCompare(String(b.fullName || b.email || ''));
      })
      .slice(0, 12);
  }, [users, currentProfileId, directSearch]);

  // ---- Avatar ----
  const avatarForProfile = useCallback(
    (profileId: string, size: 'xs' | 'sm' | 'md' | 'lg' = 'md') => {
      const u = userByProfileId.get(profileId);
      const url = u?.avatar;
      const label = (getDisplayName(profileId) || '').slice(0, 2).toUpperCase();
      const dim =
        size === 'xs'
          ? 'h-6 w-6 text-[9px]'
          : size === 'sm'
            ? 'h-8 w-8 text-[10px]'
            : size === 'lg'
              ? 'h-16 w-16 text-base'
              : 'h-10 w-10 text-xs';
      if (url) {
        return <img src={url} alt="" className={`${dim} rounded-full object-cover border border-slate-200 shrink-0`} />;
      }
      return (
        <div
          className={`${dim} rounded-full flex items-center justify-center font-semibold shrink-0 border`}
          style={{ background: 'rgba(13,122,43,0.10)', color: COYA_PRIMARY, borderColor: 'rgba(13,122,43,0.25)' }}
        >
          {label}
        </div>
      );
    },
    [userByProfileId, getDisplayName],
  );

  // ---- Avatar de conversation (groupe ou individu) ----
  const ConversationAvatar: React.FC<{ conv: Conversation; size?: 'sm' | 'md' | 'lg' }> = ({ conv, size = 'md' }) => {
    if (conv.kind === 'direct' && conv.primaryProfileId) {
      return <>{avatarForProfile(conv.primaryProfileId, size)}</>;
    }
    const dim =
      size === 'sm' ? 'h-8 w-8 text-xs' : size === 'lg' ? 'h-16 w-16 text-2xl' : 'h-10 w-10 text-sm';
    return (
      <div
        className={`${dim} rounded-full flex items-center justify-center shrink-0 border`}
        style={{ background: 'rgba(13,122,43,0.12)', color: COYA_PRIMARY, borderColor: 'rgba(13,122,43,0.25)' }}
        aria-hidden
      >
        <i className="fas fa-users" />
      </div>
    );
  };

  // ---- Snippet pour l'item de conversation ----
  const lastSnippetFor = useCallback(
    (conv: Conversation): { text: string; senderLabel: string | null; messageType?: messagingService.ChatMessageType } => {
      const lm = lastMessageMap[conv.key];
      if (lm) {
        const senderLabel = lm.senderId === currentProfileId ? (isFr ? 'Vous' : 'You') : getDisplayName(lm.senderId);
        let text = '';
        if (lm.messageType === 'voice') text = isFr ? 'Message vocal' : 'Voice message';
        else if (lm.attachmentUrl) {
          const meta = fileMetaFromMessage(lm);
          text = meta ? meta.name : isFr ? 'Pièce jointe' : 'Attachment';
        } else text = lm.content;
        return { text: snippetText(text, 70), senderLabel: conv.kind === 'channel' ? senderLabel : null, messageType: lm.messageType };
      }
      if (conv.kind === 'channel' && conv.description) return { text: conv.description, senderLabel: null };
      return {
        text: conv.kind === 'direct' ? (isFr ? 'Message direct' : 'Direct message') : isFr ? 'Canal d’équipe' : 'Team channel',
        senderLabel: null,
      };
    },
    [lastMessageMap, currentProfileId, getDisplayName, isFr],
  );

  // ---- Auto-scroll ----
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeMessages = useMemo(
    () =>
      activeSel?.kind === 'channel'
        ? channelMessages
        : activeSel?.kind === 'direct'
          ? directMessages
          : [],
    [activeSel?.kind, channelMessages, directMessages],
  );
  // Le scroll se déclenche uniquement quand la conversation change OU quand un message
  // est ajouté/supprimé (longueur), pas à chaque re-render parent (ex: filtre ou favori).
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [activeMessages.length, activeConvKey]);

  // ---- Gestion clavier input ----
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const el = e.currentTarget;
      const cur = el.selectionStart ?? activeDraft.length;
      const meta = messagingMentions.getActiveMentionQuery(activeDraft, cur);
      if (e.key === 'Escape' && meta) {
        e.preventDefault();
        stripMentionFragment();
        return;
      }
      if (meta && mentionRows.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMentionIdx((i) => Math.min(i + 1, mentionRows.length - 1));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMentionIdx((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          const row = mentionRows[mentionIdx];
          if (row) applyMention(row);
          return;
        }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void sendActiveText();
      }
    },
    [activeDraft, mentionRows, mentionIdx, stripMentionFragment, applyMention, sendActiveText],
  );

  // ---- Fichiers partagés du fil actif ----
  const sharedFiles = useMemo(() => {
    const list = activeMessages.filter((m) => !!m.attachmentUrl && m.messageType !== 'voice');
    return list.slice(-12).reverse().map((m) => ({ msg: m, meta: fileMetaFromMessage(m) }));
  }, [activeMessages]);

  const activeMembers = useMemo(() => {
    if (activeSel?.kind === 'channel') return activeChannelMembers;
    if (activeSel?.kind === 'direct') return activeThread?.memberIds || [];
    return [];
  }, [activeSel, activeChannelMembers, activeThread?.memberIds]);

  // ---- Compteur tabs ----
  const counts = useMemo(() => {
    const unread = conversations.filter((c) => isConvUnread(c)).length;
    const fav = conversations.filter((c) => favorites.has(c.key)).length;
    return { all: conversations.length, unread, fav };
  }, [conversations, isConvUnread, favorites]);

  // ============================================================
  // Rendu
  // ============================================================
  return (
    <div
      translate="no"
      className="flex flex-col h-[calc(100dvh-3.5rem)] min-h-[480px] max-h-[calc(100dvh-3.5rem)] text-slate-900"
      style={{ background: '#f8fafc' }}
    >
      {/* Header module */}
      <header
        className="px-4 sm:px-6 py-3 bg-white/80 backdrop-blur border-b shrink-0 flex items-center justify-between gap-3"
        style={{ borderColor: '#e2e8f0' }}
      >
        <div className="min-w-0">
          <h1 className="text-[18px] font-semibold tracking-tight" style={{ color: '#0f172a' }}>
            {isFr ? 'Messagerie interne' : 'Internal messaging'}
          </h1>
          <p className="text-[12px]" style={{ color: '#64748b' }}>
            {isFr ? 'Communiquez facilement avec vos équipes' : 'Communicate easily with your teams'}
          </p>
        </div>
        <div className="hidden md:flex items-center gap-2 max-w-md flex-1 justify-end">
          <div className="relative w-full max-w-sm">
            <i
              className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-[12px] pointer-events-none"
              style={{ color: '#94a3b8' }}
            />
            <input
              type="search"
              value={listSearch}
              onChange={(e) => setListSearch(e.target.value)}
              placeholder={isFr ? 'Rechercher une conversation, un contact…' : 'Search conversation, contact…'}
              className="w-full rounded-xl border bg-white pl-9 pr-3 py-2 text-[13px] outline-none transition-colors focus:border-emerald-700/40 focus:ring-2 focus:ring-emerald-700/10"
              style={{ borderColor: '#e2e8f0', color: '#0f172a' }}
            />
          </div>
        </div>
      </header>

      {error && (
        <div className="mx-4 mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 shrink-0">
          {error}
        </div>
      )}

      {/* Container 3 colonnes */}
      <div
        className="flex flex-1 min-h-0 m-2 sm:m-4 rounded-xl border bg-white overflow-hidden shadow-sm"
        style={{ borderColor: '#e2e8f0' }}
      >
        {/* ============== Colonne 1 : Liste de conversations ============== */}
        <aside
          className={`${activeConvKey ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-[300px] lg:w-[320px] shrink-0 border-r`}
          style={{ borderColor: '#e2e8f0', background: '#ffffff' }}
        >
          {/* Header liste */}
          <div className="px-4 pt-4 pb-2 border-b shrink-0 space-y-3" style={{ borderColor: '#f1f5f9' }}>
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold tracking-tight" style={{ color: '#0f172a' }}>
                {isFr ? 'Conversations' : 'Conversations'}
              </h2>
              <div className="flex items-center gap-1">
                {isAdminMessaging && (
                  <button
                    type="button"
                    onClick={() => setShowAdminCreate((v) => !v)}
                    title={isFr ? 'Nouveau canal' : 'New channel'}
                    className="h-8 w-8 rounded-lg flex items-center justify-center text-white shadow-sm transition-colors"
                    style={{ background: COYA_PRIMARY }}
                  >
                    <i className="fas fa-plus text-[12px]" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowNewDirect((v) => !v)}
                  title={isFr ? 'Nouveau message direct' : 'New direct message'}
                  className="h-8 w-8 rounded-lg flex items-center justify-center border transition-colors hover:bg-slate-50"
                  style={{ borderColor: 'rgba(13, 122, 43, 1)', color: 'rgba(132, 245, 166, 1)' }}
                >
                  <i className="fas fa-pen-to-square text-[12px]" />
                </button>
              </div>
            </div>

            {/* Recherche */}
            <div className="relative">
              <i
                className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-[12px] pointer-events-none"
                style={{ color: '#94a3b8' }}
              />
              <input
                type="search"
                value={listSearch}
                onChange={(e) => setListSearch(e.target.value)}
                placeholder={isFr ? 'Rechercher une conversation…' : 'Search a conversation…'}
                className="w-full rounded-xl bg-slate-50 border pl-9 pr-3 py-2 text-[13px] outline-none transition-colors focus:bg-white focus:border-emerald-700/40 focus:ring-2 focus:ring-emerald-700/10"
                style={{ borderColor: '#e2e8f0', color: '#0f172a' }}
              />
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1">
              {([
                { id: 'all', label: isFr ? 'Toutes' : 'All', n: counts.all },
                { id: 'unread', label: isFr ? 'Non lues' : 'Unread', n: counts.unread },
                { id: 'favorites', label: isFr ? 'Favoris' : 'Favorites', n: counts.fav },
              ] as Array<{ id: ConvFilter; label: string; n: number }>).map((t) => {
                const isActive = convFilter === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setConvFilter(t.id)}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                      isActive ? 'shadow-sm' : ''
                    }`}
                    style={
                      isActive
                        ? { background: COYA_PRIMARY, color: '#fff' }
                        : { color: '#64748b', background: '#f8fafc' }
                    }
                  >
                    <span>{t.label}</span>
                    {t.id === 'unread' && t.n > 0 ? (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold tabular-nums"
                        style={
                          isActive
                            ? { background: 'rgba(255,255,255,0.2)', color: '#fff' }
                            : { background: COYA_PRIMARY, color: '#fff' }
                        }
                      >
                        {t.n}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Picker nouveau message direct (collapsible) */}
          {showNewDirect && (
            <div className="px-4 py-3 border-b space-y-2" style={{ borderColor: '#f1f5f9', background: '#fafbfc' }}>
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#64748b' }}>
                  {isFr ? 'Nouveau message direct' : 'New direct message'}
                </p>
                <button
                  type="button"
                  onClick={() => setShowNewDirect(false)}
                  className="text-[11px]"
                  style={{ color: '#64748b' }}
                >
                  <i className="fas fa-times" />
                </button>
              </div>
              <input
                type="text"
                value={directSearch}
                onChange={(e) => setDirectSearch(e.target.value)}
                placeholder={isFr ? 'Rechercher une personne…' : 'Search a person…'}
                className="w-full rounded-lg border bg-white px-3 py-2 text-[13px] outline-none focus:border-emerald-700/40 focus:ring-2 focus:ring-emerald-700/10"
                style={{ borderColor: '#e2e8f0' }}
              />
              <div className="max-h-40 overflow-y-auto space-y-0.5">
                {availableDirectUsers.map((u) => {
                  const pid = String((u as any).profileId || u.id || '');
                  const isSelf = pid === currentProfileId;
                  return (
                    <button
                      key={pid}
                      type="button"
                      disabled={openingThread || !currentProfileId || !organizationId}
                      onClick={() => void openDirectThread(pid)}
                      className="w-full text-left px-2 py-1.5 rounded-lg text-[13px] hover:bg-white disabled:opacity-50 flex items-center gap-2 transition-colors"
                      style={{ color: '#0f172a' }}
                    >
                      <span className="shrink-0">{avatarForProfile(pid, 'sm')}</span>
                      <span className="truncate">
                        {u.fullName || u.name || u.email}
                        {isSelf ? (
                          <span className="ml-1 text-[11px] font-semibold" style={{ color: COYA_PRIMARY }}>
                            {isFr ? '(moi)' : '(me)'}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Form admin create channel (collapsible) */}
          {isAdminMessaging && showAdminCreate && (
            <div className="px-4 py-3 border-b space-y-2" style={{ borderColor: '#f1f5f9', background: '#fafbfc' }}>
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#64748b' }}>
                  {isFr ? 'Nouveau canal' : 'New channel'}
                </p>
                <button
                  type="button"
                  onClick={() => setShowAdminCreate(false)}
                  className="text-[11px]"
                  style={{ color: '#64748b' }}
                >
                  <i className="fas fa-times" />
                </button>
              </div>
              <input
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder={isFr ? 'Nom du canal' : 'Channel name'}
                className="w-full rounded-lg border bg-white px-3 py-2 text-[13px] outline-none focus:border-emerald-700/40"
                style={{ borderColor: '#e2e8f0' }}
              />
              <input
                type="text"
                value={createDesc}
                onChange={(e) => setCreateDesc(e.target.value)}
                placeholder={isFr ? 'Description' : 'Description'}
                className="w-full rounded-lg border bg-white px-3 py-2 text-[13px] outline-none focus:border-emerald-700/40"
                style={{ borderColor: '#e2e8f0' }}
              />
              <div className="grid grid-cols-3 gap-1 text-[11px]">
                {(['public', 'private', 'announcement'] as messagingService.ChatChannelType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setCreateType(t)}
                    className="rounded-lg px-2 py-1.5 font-medium transition-colors border"
                    style={
                      createType === t
                        ? { background: COYA_PRIMARY, color: '#fff', borderColor: COYA_PRIMARY }
                        : { background: '#fff', color: '#475569', borderColor: '#e2e8f0' }
                    }
                  >
                    {t === 'public'
                      ? isFr
                        ? 'Public'
                        : 'Public'
                      : t === 'private'
                        ? isFr
                          ? 'Privé'
                          : 'Private'
                        : isFr
                          ? 'Annonce'
                          : 'Announce'}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-1 text-[11px]">
                {(['all', 'manual'] as Array<'all' | 'manual'>).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setCreateAudience(a)}
                    className="rounded-lg px-2 py-1.5 font-medium transition-colors border"
                    style={
                      createAudience === a
                        ? { background: COYA_PRIMARY, color: '#fff', borderColor: COYA_PRIMARY }
                        : { background: '#fff', color: '#475569', borderColor: '#e2e8f0' }
                    }
                  >
                    {a === 'all' ? (isFr ? 'Tous' : 'All') : isFr ? 'Manuel' : 'Manual'}
                  </button>
                ))}
              </div>
              {createAudience === 'manual' && (
                <div
                  className="max-h-28 overflow-y-auto rounded-lg border p-2 space-y-1 bg-white"
                  style={{ borderColor: '#e2e8f0' }}
                >
                  {users.map((u) => {
                    const pid = String((u as any).profileId || u.id || '');
                    const checked = createMemberIds.includes(pid);
                    return (
                      <label key={pid} className="flex items-center gap-2 text-[12px]" style={{ color: '#334155' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setCreateMemberIds((prev) =>
                              e.target.checked ? [...prev, pid] : prev.filter((id) => id !== pid),
                            )
                          }
                        />
                        <span className="truncate">{u.fullName || u.name || u.email}</span>
                      </label>
                    );
                  })}
                </div>
              )}
              <button
                type="button"
                onClick={handleCreateChannel}
                disabled={savingChannel || !createName.trim()}
                className="w-full rounded-lg text-white px-3 py-2 text-[13px] font-medium disabled:opacity-50 transition-colors"
                style={{ background: COYA_PRIMARY }}
              >
                {savingChannel ? (isFr ? 'Création…' : 'Creating…') : isFr ? 'Créer le canal' : 'Create channel'}
              </button>
            </div>
          )}

          {/* Liste */}
          <ul className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain">
            {loading && (
              <li className="px-4 py-3 text-[12px]" style={{ color: '#64748b' }}>
                <i className="fas fa-spinner fa-spin mr-2" /> {isFr ? 'Chargement…' : 'Loading…'}
              </li>
            )}
            {filteredConversations.map((c) => {
              const active = activeConvKey === c.key;
              const unread = isConvUnread(c);
              const fav = favorites.has(c.key);
              const snip = lastSnippetFor(c);
              const time = formatRelativeShort(c.updatedAt || lastMessageMap[c.key]?.createdAt, isFr);
              return (
                <li key={c.key}>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveConvKey(c.key);
                      markRead(c.key);
                    }}
                    className={`group w-full text-left px-3 py-3 flex gap-3 transition-colors border-l-2 ${
                      active ? '' : 'border-l-transparent hover:bg-slate-50'
                    }`}
                    style={
                      active
                        ? { background: 'rgba(13,122,43,0.08)', borderLeftColor: COYA_PRIMARY }
                        : undefined
                    }
                  >
                    <div className="shrink-0">
                      <ConversationAvatar conv={c} size="md" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <span
                          className={`block text-[13.5px] truncate ${unread ? 'font-semibold' : 'font-medium'}`}
                          style={{ color: active ? COYA_PRIMARY : '#0f172a' }}
                        >
                          {c.title}
                        </span>
                        <span
                          className="text-[11px] tabular-nums shrink-0"
                          style={{ color: unread ? COYA_PRIMARY : '#94a3b8', fontWeight: unread ? 600 : 400 }}
                        >
                          {time}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <span
                          className={`block text-[12px] truncate ${unread ? 'font-medium' : ''}`}
                          style={{ color: unread ? '#334155' : '#64748b' }}
                        >
                          {snip.senderLabel ? <span className="font-medium">{snip.senderLabel}: </span> : null}
                          <span>{snip.text}</span>
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          {fav ? (
                            <i
                              className="fas fa-star text-[10px]"
                              style={{ color: '#f4c430' }}
                              title={isFr ? 'Favori' : 'Favorite'}
                            />
                          ) : null}
                          {unread ? (
                            <span
                              className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-semibold text-white px-1"
                              style={{ background: COYA_PRIMARY }}
                            >
                              <i className="fas fa-circle text-[6px]" />
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
            {!loading && filteredConversations.length === 0 && (
              <li className="px-4 py-12 text-center text-[13px]" style={{ color: '#64748b' }}>
                {convFilter === 'favorites'
                  ? isFr
                    ? 'Aucun favori. Cliquez sur l’étoile dans le panneau de droite.'
                    : 'No favorites yet. Click the star in the right panel.'
                  : convFilter === 'unread'
                    ? isFr
                      ? 'Aucune conversation non lue.'
                      : 'No unread conversation.'
                    : isFr
                      ? 'Aucune conversation pour le moment.'
                      : 'No conversation yet.'}
              </li>
            )}
          </ul>

          <div className="px-4 py-3 border-t shrink-0" style={{ borderColor: '#f1f5f9' }}>
            <p className="text-[11px] text-center" style={{ color: COYA_PRIMARY, fontWeight: 500 }}>
              {isFr ? 'Voir toutes les conversations' : 'See all conversations'}
            </p>
          </div>
        </aside>

        {/* ============== Colonne 2 : Chat principal ============== */}
        <main className={`${activeConvKey ? 'flex' : 'hidden md:flex'} flex-col min-w-0 flex-1`} style={{ background: '#f8fafc' }}>
          {/* Header chat */}
          <div
            className="px-4 sm:px-5 h-16 border-b shrink-0 flex items-center justify-between gap-3 bg-white"
            style={{ borderColor: '#e2e8f0' }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                className="md:hidden h-8 w-8 rounded-lg flex items-center justify-center hover:bg-slate-100"
                onClick={() => setActiveConvKey('')}
                title={isFr ? 'Retour' : 'Back'}
              >
                <i className="fas fa-arrow-left text-[13px]" style={{ color: '#64748b' }} />
              </button>
              {activeConv ? (
                <>
                  <ConversationAvatar conv={activeConv} size="md" />
                  <div className="min-w-0">
                    <p
                      className="font-semibold truncate text-[15px] leading-tight"
                      style={{ color: '#0f172a' }}
                    >
                      {activeConv.title}
                    </p>
                    <p className="text-[12px]" style={{ color: '#64748b' }}>
                      {activeConv.kind === 'channel'
                        ? isFr
                          ? `${activeChannelMembers.length} membre${activeChannelMembers.length > 1 ? 's' : ''}`
                          : `${activeChannelMembers.length} member${activeChannelMembers.length > 1 ? 's' : ''}`
                        : isFr
                          ? `${activeMembers.length} participant${activeMembers.length > 1 ? 's' : ''}`
                          : `${activeMembers.length} participant${activeMembers.length > 1 ? 's' : ''}`}
                    </p>
                  </div>
                </>
              ) : (
                <p className="text-[14px]" style={{ color: '#64748b' }}>
                  {isFr ? 'Sélectionnez une conversation' : 'Select a conversation'}
                </p>
              )}
            </div>
            {activeConv && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="h-9 w-9 rounded-lg flex items-center justify-center hover:bg-slate-100 transition-colors"
                  title={isFr ? 'Rechercher dans la conversation (bientôt)' : 'Search in conversation (soon)'}
                  style={{ color: '#64748b' }}
                >
                  <i className="fas fa-search text-[13px]" />
                </button>
                <button
                  type="button"
                  disabled
                  className="h-9 w-9 rounded-lg flex items-center justify-center opacity-50 cursor-not-allowed"
                  title={isFr ? 'Appel vocal — bientôt disponible' : 'Voice call — coming soon'}
                  style={{ color: '#64748b' }}
                >
                  <i className="fas fa-phone text-[13px]" />
                </button>
                <button
                  type="button"
                  disabled
                  className="h-9 w-9 rounded-lg flex items-center justify-center opacity-50 cursor-not-allowed"
                  title={isFr ? 'Appel vidéo — bientôt disponible' : 'Video call — coming soon'}
                  style={{ color: '#64748b' }}
                >
                  <i className="fas fa-video text-[13px]" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowDetails((v) => !v)}
                  className="h-9 w-9 rounded-lg flex items-center justify-center hover:bg-slate-100 transition-colors"
                  title={isFr ? 'Détails' : 'Details'}
                  style={{ color: showDetails ? COYA_PRIMARY : '#64748b' }}
                >
                  <i className="fas fa-info-circle text-[13px]" />
                </button>
              </div>
            )}
          </div>

          {/* Bandeau admin éditeur de membres (canal) */}
          {activeChannel && isAdminMessaging && (
            <div className="border-b px-4 py-2 shrink-0" style={{ borderColor: '#f1f5f9', background: '#fafbfc' }}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setShowMembersEditor((v) => !v)}
                  className="text-[12px] font-medium"
                  style={{ color: '#475569' }}
                >
                  {showMembersEditor ? '▼ ' : '▸ '}
                  {isFr ? 'Membres du canal' : 'Channel members'} ({activeChannelMembers.length})
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleRenameActiveChannel}
                    className="text-[11px] px-2.5 py-1 rounded-lg border hover:bg-white"
                    style={{ borderColor: '#e2e8f0', color: '#475569' }}
                  >
                    {isFr ? 'Renommer' : 'Rename'}
                  </button>
                  <button
                    type="button"
                    onClick={handleArchiveActiveChannel}
                    className="text-[11px] px-2.5 py-1 rounded-lg border border-red-200 text-red-700 hover:bg-red-50"
                  >
                    {isFr ? 'Archiver' : 'Archive'}
                  </button>
                </div>
              </div>
              {showMembersEditor && (
                <div className="mt-2 space-y-2">
                  <div
                    className="max-h-36 overflow-y-auto rounded-lg border p-2 space-y-1 bg-white"
                    style={{ borderColor: '#e2e8f0' }}
                  >
                    {users.map((u) => {
                      const pid = String((u as any).profileId || u.id || '');
                      return (
                        <label key={pid} className="flex items-center gap-2 text-[12px]" style={{ color: '#334155' }}>
                          <input
                            type="checkbox"
                            checked={channelMemberDraft.includes(pid)}
                            onChange={(e) =>
                              setChannelMemberDraft((prev) =>
                                e.target.checked ? dedupeIds([...prev, pid]) : prev.filter((x) => x !== pid),
                              )
                            }
                          />
                          <span className="truncate">{u.fullName || u.name || u.email}</span>
                        </label>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={persistChannelMembers}
                    disabled={savingChannelMembers}
                    className="rounded-lg text-white text-[12px] px-3 py-1.5 disabled:opacity-50"
                    style={{ background: COYA_PRIMARY }}
                  >
                    {savingChannelMembers
                      ? isFr
                        ? 'Enregistrement…'
                        : 'Saving…'
                      : isFr
                        ? 'Enregistrer les membres'
                        : 'Save members'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Zone messages */}
          <div ref={scrollerRef} className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-3 sm:px-6 py-4">
            {!activeConv ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-6">
                <div
                  className="h-16 w-16 rounded-2xl flex items-center justify-center mb-4 border"
                  style={{
                    background: 'rgba(13,122,43,0.08)',
                    color: COYA_PRIMARY,
                    borderColor: 'rgba(13,122,43,0.2)',
                  }}
                >
                  <i className="fas fa-comments text-xl" />
                </div>
                <p className="text-[14px] max-w-xs" style={{ color: '#64748b' }}>
                  {isFr
                    ? 'Sélectionnez une conversation à gauche, ou démarrez un nouveau message direct.'
                    : 'Pick a conversation on the left, or start a new direct message.'}
                </p>
              </div>
            ) : activeMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-6">
                <div
                  className="h-14 w-14 rounded-full flex items-center justify-center mb-3 border"
                  style={{
                    background: 'rgba(13,122,43,0.08)',
                    color: COYA_PRIMARY,
                    borderColor: 'rgba(13,122,43,0.2)',
                  }}
                >
                  <i className="fas fa-comment-dots text-lg" />
                </div>
                <p className="text-[13px] max-w-xs" style={{ color: '#64748b' }}>
                  {activeConv.kind === 'channel'
                    ? isFr
                      ? 'Aucun message pour le moment. Dites bonjour au canal.'
                      : 'No messages yet. Say hello to the channel.'
                    : isFr
                      ? 'Pas encore de message. Commencez la conversation.'
                      : 'No messages yet. Start the conversation.'}
                </p>
              </div>
            ) : (
              <div className="mx-auto max-w-[760px] space-y-1">
                {activeMessages.map((m, idx) => {
                  const meta = clusterMeta(activeMessages, idx, currentProfileId);
                  const senderName = getDisplayName(m.senderId);
                  const time = m.createdAt
                    ? new Date(m.createdAt).toLocaleTimeString(dayLocale, { hour: '2-digit', minute: '2-digit' })
                    : '';
                  const fileMeta = fileMetaFromMessage(m);
                  const msgReactions = reactions[m.id] || {};
                  const reactionEntries = Object.entries(msgReactions);

                  if (m.messageType === 'system') {
                    return (
                      <div key={m.id} className={meta.showDayDivider ? 'mt-5' : 'mt-2'}>
                        {meta.showDayDivider && (
                          <div className="flex justify-center my-3">
                            <span
                              className="text-[11px] font-medium px-3 py-1 rounded-full border bg-white"
                              style={{ color: '#64748b', borderColor: '#e2e8f0' }}
                            >
                              {formatDayLabel(meta.d, isFr)}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-center">
                          <span
                            className="text-[11px] px-3 py-1.5 rounded-full border bg-white max-w-[90%] text-center"
                            style={{ color: '#64748b', borderColor: '#e2e8f0' }}
                          >
                            {renderContentWithMentions(m.content)}
                          </span>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={m.id}>
                      {meta.showDayDivider && (
                        <div className="flex items-center justify-center my-4 first:mt-0 gap-3">
                          <div className="flex-1 h-px" style={{ background: '#e2e8f0' }} aria-hidden />
                          <span
                            className="text-[11px] font-medium px-3 py-1 rounded-full border bg-white"
                            style={{ color: '#64748b', borderColor: '#e2e8f0' }}
                          >
                            {formatDayLabel(meta.d, isFr)}
                          </span>
                          <div className="flex-1 h-px" style={{ background: '#e2e8f0' }} aria-hidden />
                        </div>
                      )}
                      {meta.isMe ? (
                        <div className={`group flex justify-end ${meta.dense ? 'mt-1' : 'mt-3'}`}>
                          <div className="max-w-[min(82%,520px)] flex flex-col items-end">
                            <div className="flex items-end gap-1.5">
                              {/* Reaction trigger left of bubble */}
                              <button
                                type="button"
                                onClick={() => setShowReactionPickerFor((cur) => (cur === m.id ? null : m.id))}
                                className="opacity-0 group-hover:opacity-100 h-7 w-7 rounded-full flex items-center justify-center bg-white border shadow-sm transition-opacity"
                                style={{ borderColor: '#e2e8f0', color: '#64748b' }}
                                title={isFr ? 'Réagir' : 'React'}
                              >
                                <i className="fas fa-smile text-[11px]" />
                              </button>
                              <div
                                className="rounded-2xl rounded-br-sm px-3.5 py-2 shadow-sm border"
                                style={{
                                  background: 'rgba(13,122,43,0.10)',
                                  borderColor: 'rgba(13,122,43,0.18)',
                                  color: '#0f172a',
                                }}
                              >
                                {m.messageType === 'voice' && m.attachmentUrl ? (
                                  <audio controls src={m.attachmentUrl} className="w-full max-w-[260px]" />
                                ) : null}
                                {m.messageType !== 'voice' && fileMeta ? (
                                  <FileCard
                                    fileMeta={fileMeta}
                                    url={m.attachmentUrl || ''}
                                    isFr={isFr}
                                    forSelf
                                  />
                                ) : null}
                                {m.messageType !== 'voice' && !fileMeta ? (
                                  <p className="text-[14px] leading-snug whitespace-pre-wrap break-words">
                                    {renderContentWithMentions(m.content)}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 mt-1 pr-1">
                              {reactionEntries.length > 0 && (
                                <ReactionsBar
                                  entries={reactionEntries}
                                  currentProfileId={currentProfileId}
                                  onToggle={(emoji) => toggleReaction(m.id, emoji)}
                                />
                              )}
                              <span className="text-[10px] tabular-nums" style={{ color: '#94a3b8' }}>
                                {time}
                              </span>
                              <i className="fas fa-check-double text-[10px]" style={{ color: COYA_SECONDARY }} />
                            </div>
                            {showReactionPickerFor === m.id && (
                              <ReactionPicker
                                onPick={(emoji) => {
                                  toggleReaction(m.id, emoji);
                                  setShowReactionPickerFor(null);
                                }}
                                onClose={() => setShowReactionPickerFor(null)}
                              />
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className={`group flex gap-2 items-end ${meta.dense ? 'mt-1' : 'mt-3'}`}>
                          <div className="w-8 shrink-0 flex justify-center pb-6">
                            {meta.showPeerAvatar ? (
                              <div className="scale-90">{avatarForProfile(m.senderId, 'sm')}</div>
                            ) : null}
                          </div>
                          <div className="min-w-0 flex-1 max-w-[min(82%,520px)]">
                            {meta.showSenderLabel && (
                              <p className="text-[12px] font-medium mb-0.5 pl-1" style={{ color: '#0f172a' }}>
                                {senderName}
                              </p>
                            )}
                            <div className="flex items-end gap-1.5">
                              <div
                                className="rounded-2xl rounded-tl-sm bg-white px-3.5 py-2 shadow-sm border"
                                style={{ borderColor: '#e2e8f0', color: '#0f172a' }}
                              >
                                {m.messageType === 'voice' && m.attachmentUrl ? (
                                  <audio controls src={m.attachmentUrl} className="w-full max-w-[260px]" />
                                ) : null}
                                {m.messageType !== 'voice' && fileMeta ? (
                                  <FileCard fileMeta={fileMeta} url={m.attachmentUrl || ''} isFr={isFr} />
                                ) : null}
                                {m.messageType !== 'voice' && !fileMeta ? (
                                  <p className="text-[14px] leading-snug whitespace-pre-wrap break-words">
                                    {renderContentWithMentions(m.content)}
                                  </p>
                                ) : null}
                              </div>
                              <button
                                type="button"
                                onClick={() => setShowReactionPickerFor((cur) => (cur === m.id ? null : m.id))}
                                className="opacity-0 group-hover:opacity-100 h-7 w-7 rounded-full flex items-center justify-center bg-white border shadow-sm transition-opacity"
                                style={{ borderColor: '#e2e8f0', color: '#64748b' }}
                                title={isFr ? 'Réagir' : 'React'}
                              >
                                <i className="fas fa-smile text-[11px]" />
                              </button>
                            </div>
                            <div className="flex items-center gap-1.5 mt-1 pl-1">
                              {reactionEntries.length > 0 && (
                                <ReactionsBar
                                  entries={reactionEntries}
                                  currentProfileId={currentProfileId}
                                  onToggle={(emoji) => toggleReaction(m.id, emoji)}
                                />
                              )}
                              <span className="text-[10px] tabular-nums" style={{ color: '#94a3b8' }}>
                                {time}
                              </span>
                            </div>
                            {showReactionPickerFor === m.id && (
                              <ReactionPicker
                                onPick={(emoji) => {
                                  toggleReaction(m.id, emoji);
                                  setShowReactionPickerFor(null);
                                }}
                                onClose={() => setShowReactionPickerFor(null)}
                              />
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Composer */}
          {activeConv && (
            <div className="px-3 sm:px-6 py-3 border-t shrink-0 bg-white" style={{ borderColor: '#e2e8f0' }}>
              <div className="mx-auto max-w-[760px]">
                {(pendingFile || pendingVoice) && (
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    {pendingFile && (
                      <div
                        className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px]"
                        style={{ borderColor: '#e2e8f0', background: '#f8fafc', color: '#334155' }}
                      >
                        <i className="fas fa-paperclip text-[11px]" style={{ color: COYA_PRIMARY }} />
                        <span className="truncate max-w-[180px]">{pendingFile.name}</span>
                        <button
                          type="button"
                          onClick={() => setPendingFile(null)}
                          className="text-[11px]"
                          style={{ color: '#94a3b8' }}
                        >
                          <i className="fas fa-times" />
                        </button>
                        <button
                          type="button"
                          onClick={sendActiveFile}
                          disabled={sending}
                          className="text-[11px] font-medium ml-1"
                          style={{ color: COYA_PRIMARY }}
                        >
                          {isFr ? 'Envoyer' : 'Send'}
                        </button>
                      </div>
                    )}
                    {pendingVoice && (
                      <div
                        className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px]"
                        style={{ borderColor: '#e2e8f0', background: '#f8fafc', color: '#334155' }}
                      >
                        <i className="fas fa-microphone text-[11px]" style={{ color: COYA_PRIMARY }} />
                        <span className="truncate max-w-[180px]">{pendingVoice.name}</span>
                        <button
                          type="button"
                          onClick={() => setPendingVoice(null)}
                          className="text-[11px]"
                          style={{ color: '#94a3b8' }}
                        >
                          <i className="fas fa-times" />
                        </button>
                        <button
                          type="button"
                          onClick={sendActiveVoice}
                          disabled={sending}
                          className="text-[11px] font-medium ml-1"
                          style={{ color: COYA_PRIMARY }}
                        >
                          {isFr ? 'Envoyer' : 'Send'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <div
                  className="flex items-end gap-1 rounded-2xl border bg-white px-2 py-1.5 transition-colors focus-within:border-emerald-700/40 focus-within:ring-2 focus-within:ring-emerald-700/10"
                  style={{ borderColor: '#e2e8f0' }}
                >
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      className="h-9 w-9 rounded-lg flex items-center justify-center hover:bg-slate-100 transition-colors"
                      title={isFr ? 'Emoji' : 'Emoji'}
                      style={{ color: '#64748b' }}
                      onClick={() => {
                        const e = '🙂';
                        setActiveDraft(activeDraft + e);
                      }}
                    >
                      <i className="fas fa-smile text-[14px]" />
                    </button>
                    <label
                      className="h-9 w-9 rounded-lg flex items-center justify-center hover:bg-slate-100 cursor-pointer transition-colors"
                      title={isFr ? 'Joindre un fichier' : 'Attach file'}
                      style={{ color: '#64748b' }}
                    >
                      <i className="fas fa-paperclip text-[14px]" />
                      <input
                        type="file"
                        className="hidden"
                        onChange={(e) => setPendingFile(e.target.files?.[0] || null)}
                      />
                    </label>
                    <label
                      className="h-9 w-9 rounded-lg flex items-center justify-center hover:bg-slate-100 cursor-pointer transition-colors"
                      title={isFr ? 'Joindre une image' : 'Attach image'}
                      style={{ color: '#64748b' }}
                    >
                      <i className="fas fa-image text-[14px]" />
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => setPendingFile(e.target.files?.[0] || null)}
                      />
                    </label>
                    <label
                      className="h-9 w-9 rounded-lg flex items-center justify-center hover:bg-slate-100 cursor-pointer transition-colors"
                      title={isFr ? 'Joindre un audio' : 'Attach audio'}
                      style={{ color: '#64748b' }}
                    >
                      <i className="fas fa-microphone text-[14px]" />
                      <input
                        type="file"
                        accept="audio/*"
                        className="hidden"
                        onChange={(e) => setPendingVoice(e.target.files?.[0] || null)}
                      />
                    </label>
                    <button
                      type="button"
                      className="h-9 w-9 rounded-lg flex items-center justify-center hover:bg-slate-100 transition-colors"
                      title={isFr ? 'Mentionner (@)' : 'Mention (@)'}
                      style={{ color: '#64748b' }}
                      onClick={() => {
                        const next = activeDraft + '@';
                        setActiveDraft(next);
                        setDraftCursor(next.length);
                        requestAnimationFrame(() => messageInputRef.current?.focus());
                      }}
                    >
                      <i className="fas fa-at text-[14px]" />
                    </button>
                  </div>
                  <div className="relative flex-1 min-w-0">
                    {mentionMeta && mentionRows.length > 0 ? (
                      <ul
                        className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-56 overflow-y-auto rounded-xl border bg-white py-1 shadow-xl"
                        role="listbox"
                        style={{ borderColor: '#e2e8f0' }}
                      >
                        {mentionRows.map((row, idx) => (
                          <li key={row.kind === 'broadcast' ? `b-${row.token}` : row.profile.id}>
                            <button
                              type="button"
                              role="option"
                              aria-selected={idx === mentionIdx}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors"
                              style={
                                idx === mentionIdx
                                  ? { background: 'rgba(13,122,43,0.08)', color: '#0f172a' }
                                  : { color: '#0f172a' }
                              }
                              onMouseDown={(ev) => ev.preventDefault()}
                              onMouseEnter={() => setMentionIdx(idx)}
                              onClick={() => applyMention(row)}
                            >
                              {row.kind === 'broadcast' ? (
                                <>
                                  <i className="fas fa-bullhorn w-5 text-center text-[12px]" style={{ color: COYA_PRIMARY }} />
                                  <span className="font-medium">{row.label}</span>
                                </>
                              ) : (
                                <>
                                  <span className="shrink-0">{avatarForProfile(row.profile.id, 'sm')}</span>
                                  <span className="min-w-0 truncate">
                                    <span className="font-semibold">{row.profile.fullName || row.profile.email}</span>
                                    {row.profile.email ? (
                                      <span className="block text-[11px] truncate" style={{ color: '#64748b' }}>
                                        {row.profile.email}
                                      </span>
                                    ) : null}
                                  </span>
                                </>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <input
                      ref={messageInputRef}
                      type="text"
                      value={activeDraft}
                      onChange={(e) => {
                        setActiveDraft(e.target.value);
                        setDraftCursor(e.target.selectionStart ?? e.target.value.length);
                      }}
                      onSelect={(e) => setDraftCursor((e.target as HTMLInputElement).selectionStart ?? 0)}
                      onClick={(e) => setDraftCursor((e.target as HTMLInputElement).selectionStart ?? 0)}
                      onKeyUp={(e) => setDraftCursor((e.target as HTMLInputElement).selectionStart ?? 0)}
                      onKeyDown={handleInputKeyDown}
                      placeholder={isFr ? 'Écrire un message…' : 'Write a message…'}
                      className="w-full bg-transparent border-0 px-2 py-2 text-[14px] outline-none placeholder:text-slate-400"
                      style={{ color: '#0f172a' }}
                      disabled={!activeConvKey || sending}
                      autoComplete="off"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={sendActiveText}
                    disabled={!activeConvKey || !activeDraft.trim() || sending}
                    className="shrink-0 h-9 w-9 rounded-lg text-white flex items-center justify-center disabled:opacity-40 transition-colors"
                    style={{ background: COYA_PRIMARY }}
                    title={isFr ? 'Envoyer' : 'Send'}
                  >
                    <i className="fas fa-paper-plane text-[13px]" />
                  </button>
                </div>
                <p className="text-[10px] mt-1.5 px-1" style={{ color: '#94a3b8' }}>
                  {isFr
                    ? 'Entrée pour envoyer · @ pour mentionner · joignez documents, images ou audio'
                    : 'Enter to send · @ to mention · attach docs, images or audio'}
                </p>
              </div>
            </div>
          )}
        </main>

        {/* ============== Colonne 3 : Détails ============== */}
        {showDetails && activeConv && (
          <aside
            className="hidden xl:flex flex-col w-[300px] shrink-0 border-l bg-white"
            style={{ borderColor: '#e2e8f0' }}
          >
            {/* Header */}
            <div
              className="px-4 py-3 border-b flex items-center justify-between shrink-0"
              style={{ borderColor: '#e2e8f0' }}
            >
              <p className="text-[14px] font-semibold" style={{ color: '#0f172a' }}>
                {isFr ? 'Détails de la conversation' : 'Conversation details'}
              </p>
              <button
                type="button"
                onClick={() => setShowDetails(false)}
                className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-slate-100"
                style={{ color: '#64748b' }}
              >
                <i className="fas fa-times text-[13px]" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {/* Avatar / titre */}
              <div className="px-4 py-5 border-b text-center" style={{ borderColor: '#f1f5f9' }}>
                <div className="flex justify-center mb-3">
                  <ConversationAvatar conv={activeConv} size="lg" />
                </div>
                <div className="flex items-center justify-center gap-1.5">
                  <h3 className="text-[15px] font-semibold" style={{ color: '#0f172a' }}>
                    {activeConv.title}
                  </h3>
                  {isAdminMessaging && activeConv.kind === 'channel' && (
                    <button
                      type="button"
                      onClick={handleRenameActiveChannel}
                      className="text-[11px]"
                      style={{ color: '#94a3b8' }}
                      title={isFr ? 'Renommer' : 'Rename'}
                    >
                      <i className="fas fa-pen text-[11px]" />
                    </button>
                  )}
                </div>
                <p className="text-[12px] mt-1" style={{ color: '#64748b' }}>
                  {activeConv.kind === 'channel'
                    ? isFr
                      ? `${activeConv.channelType === 'announcement' ? 'Annonce' : activeConv.channelType === 'private' ? 'Privé' : 'Groupe'} · ${activeChannelMembers.length} membre${activeChannelMembers.length > 1 ? 's' : ''}`
                      : `${activeConv.channelType === 'announcement' ? 'Announcement' : activeConv.channelType === 'private' ? 'Private' : 'Group'} · ${activeChannelMembers.length} member${activeChannelMembers.length > 1 ? 's' : ''}`
                    : isFr
                      ? 'Message direct'
                      : 'Direct message'}
                </p>
                {/* Action row */}
                <div className="grid grid-cols-4 gap-1 mt-4">
                  {[
                    {
                      icon: 'fa-user-plus',
                      label: isFr ? 'Ajouter' : 'Add',
                      onClick: () => isAdminMessaging && activeConv.kind === 'channel' && setShowMembersEditor(true),
                      disabled: !(isAdminMessaging && activeConv.kind === 'channel'),
                    },
                    {
                      icon: 'fa-search',
                      label: isFr ? 'Recherche' : 'Search',
                      disabled: true,
                    },
                    {
                      icon: 'fa-bell',
                      label: isFr ? 'Notifications' : 'Notifications',
                      onClick: () => markRead(activeConv.key),
                    },
                    {
                      icon: favorites.has(activeConv.key) ? 'fa-star' : 'fa-star',
                      label: isFr ? 'Favori' : 'Favorite',
                      onClick: () => toggleFavorite(activeConv.key),
                      starred: favorites.has(activeConv.key),
                    },
                  ].map((a, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={a.onClick}
                      disabled={a.disabled}
                      className="flex flex-col items-center gap-1 py-2 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title={a.label}
                    >
                      <span
                        className="h-9 w-9 rounded-full flex items-center justify-center border"
                        style={{
                          borderColor: a.starred ? '#f4c430' : '#e2e8f0',
                          background: a.starred ? '#fef9c3' : '#f8fafc',
                          color: a.starred ? '#a16207' : '#475569',
                        }}
                      >
                        <i className={`fas ${a.icon} text-[12px]`} />
                      </span>
                      <span className="text-[10px]" style={{ color: '#64748b' }}>
                        {a.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* À propos */}
              {(activeConv.description || activeConv.kind === 'channel') && (
                <div className="px-4 py-4 border-b" style={{ borderColor: '#f1f5f9' }}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: '#64748b' }}>
                    {isFr ? 'À propos' : 'About'}
                  </p>
                  <p className="text-[12.5px] leading-relaxed" style={{ color: '#475569' }}>
                    {activeConv.description ||
                      (isFr
                        ? `Espace de collaboration dédié à ${activeConv.title}.`
                        : `Collaboration space dedicated to ${activeConv.title}.`)}
                  </p>
                </div>
              )}

              {/* Membres */}
              {activeMembers.length > 0 && (
                <div className="px-4 py-4 border-b" style={{ borderColor: '#f1f5f9' }}>
                  <div className="flex items-center justify-between mb-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#64748b' }}>
                      {isFr ? 'Membres' : 'Members'} ({activeMembers.length})
                    </p>
                    {activeMembers.length > 4 && (
                      <button type="button" className="text-[11px] font-medium" style={{ color: COYA_PRIMARY }}>
                        {isFr ? 'Voir tout' : 'See all'}
                      </button>
                    )}
                  </div>
                  <ul className="space-y-2.5">
                    {activeMembers.slice(0, 4).map((pid) => (
                      <li key={pid} className="flex items-center gap-2.5">
                        <div className="shrink-0">{avatarForProfile(pid, 'sm')}</div>
                        <div className="min-w-0 flex-1">
                          <p
                            className="text-[12.5px] font-medium truncate leading-tight"
                            style={{ color: '#0f172a' }}
                          >
                            {getDisplayName(pid)}
                          </p>
                          <p className="text-[11px] truncate" style={{ color: '#94a3b8' }}>
                            {getRoleLabel(pid)}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {activeMembers.length > 4 && (
                    <div className="mt-2.5">
                      <span
                        className="inline-flex items-center justify-center px-2.5 py-1 rounded-full text-[11px] font-semibold"
                        style={{ background: '#f1f5f9', color: '#475569' }}
                      >
                        +{activeMembers.length - 4}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Fichiers partagés */}
              {sharedFiles.length > 0 && (
                <div className="px-4 py-4 border-b" style={{ borderColor: '#f1f5f9' }}>
                  <div className="flex items-center justify-between mb-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#64748b' }}>
                      {isFr ? 'Fichiers partagés' : 'Shared files'}
                    </p>
                    {sharedFiles.length > 3 && (
                      <button type="button" className="text-[11px] font-medium" style={{ color: COYA_PRIMARY }}>
                        {isFr ? 'Voir tout' : 'See all'}
                      </button>
                    )}
                  </div>
                  <ul className="space-y-2">
                    {sharedFiles.slice(0, 4).map(({ msg, meta }) => {
                      if (!meta || !msg.attachmentUrl) return null;
                      const ic = fileIconClass(meta.ext);
                      return (
                        <li key={msg.id}>
                          <a
                            href={msg.attachmentUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-2.5 rounded-xl border px-2.5 py-2 hover:bg-slate-50 transition-colors"
                            style={{ borderColor: '#e2e8f0' }}
                          >
                            <span
                              className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0"
                              style={{ background: ic.tint, color: ic.fg }}
                            >
                              <i className={`fas ${ic.icon} text-[14px]`} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p
                                className="text-[12.5px] font-medium truncate leading-tight"
                                style={{ color: '#0f172a' }}
                              >
                                {meta.name}
                              </p>
                              <p className="text-[11px] uppercase" style={{ color: '#94a3b8' }}>
                                {meta.ext || (isFr ? 'fichier' : 'file')}
                              </p>
                            </div>
                            <i className="fas fa-download text-[11px]" style={{ color: '#94a3b8' }} />
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Quitter */}
              {activeConv.kind === 'channel' && isAdminMessaging && (
                <div className="px-4 py-4">
                  <button
                    type="button"
                    onClick={handleArchiveActiveChannel}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-red-200 text-red-700 text-[12.5px] font-medium hover:bg-red-50 transition-colors"
                  >
                    <i className="fas fa-right-from-bracket text-[12px]" />
                    {isFr ? 'Archiver la conversation' : 'Archive conversation'}
                  </button>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};

// ============================================================
// Sous-composants
// ============================================================

const FileCard: React.FC<{
  fileMeta: { name: string; ext: string };
  url: string;
  isFr: boolean;
  forSelf?: boolean;
}> = ({ fileMeta, url, isFr, forSelf }) => {
  const ic = fileIconClass(fileMeta.ext);
  const isImg = isImageExt(fileMeta.ext);
  if (isImg && url) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block max-w-[280px] -mx-1 -my-1 my-0">
        <img
          src={url}
          alt={fileMeta.name}
          className="rounded-xl max-h-[260px] w-full object-cover border"
          style={{ borderColor: '#e2e8f0' }}
        />
        <p className="mt-1 text-[11px] truncate" style={{ color: forSelf ? '#475569' : '#64748b' }}>
          {fileMeta.name}
        </p>
      </a>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2.5 rounded-lg border bg-white px-2.5 py-2 min-w-[240px] max-w-[320px] hover:bg-slate-50 transition-colors"
      style={{ borderColor: '#e2e8f0' }}
    >
      <span
        className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: ic.tint, color: ic.fg }}
      >
        <i className={`fas ${ic.icon} text-[16px]`} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium truncate leading-tight" style={{ color: '#0f172a' }}>
          {fileMeta.name}
        </p>
        <p className="text-[11px] uppercase" style={{ color: '#94a3b8' }}>
          {fileMeta.ext || (isFr ? 'fichier' : 'file')}
        </p>
      </div>
      <i className="fas fa-download text-[12px]" style={{ color: '#94a3b8' }} />
    </a>
  );
};

const ReactionsBar: React.FC<{
  entries: Array<[string, string[]]>;
  currentProfileId: string;
  onToggle: (emoji: string) => void;
}> = ({ entries, currentProfileId, onToggle }) => {
  return (
    <div className="flex items-center gap-1">
      {entries.map(([emoji, ids]) => {
        const mine = ids.includes(currentProfileId);
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => onToggle(emoji)}
            className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] transition-colors"
            style={{
              borderColor: mine ? COYA_PRIMARY : '#e2e8f0',
              background: mine ? 'rgba(13,122,43,0.10)' : '#fff',
              color: '#0f172a',
            }}
          >
            <span className="text-[11px]">{emoji}</span>
            <span className="tabular-nums" style={{ color: mine ? COYA_PRIMARY : '#64748b' }}>
              {ids.length}
            </span>
          </button>
        );
      })}
    </div>
  );
};

const ReactionPicker: React.FC<{ onPick: (emoji: string) => void; onClose: () => void }> = ({ onPick }) => {
  return (
    <div
      className="mt-1 inline-flex items-center gap-0.5 rounded-full border bg-white px-1.5 py-1 shadow-md"
      style={{ borderColor: '#e2e8f0' }}
    >
      {QUICK_REACTIONS.map((e) => (
        <button
          key={e}
          type="button"
          onClick={() => onPick(e)}
          className="h-7 w-7 rounded-full flex items-center justify-center hover:bg-slate-100 transition-colors text-[14px]"
        >
          {e}
        </button>
      ))}
    </div>
  );
};

export default MessagerieModule;
