import React, { useEffect, useRef, useState } from 'react';
import { Animated, AppState, Alert, Linking, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as ExpoLinking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

type Screen = 'home' | 'studio' | 'settings' | 'subscription' | 'admin';
type Network = 'instagram' | 'tiktok' | 'facebook';
type PreviewFilter = 'Naturel' | 'Éclat' | 'Doux' | 'Chaud' | 'Froid' | 'Mono';
type VirtualBackground = 'Réel' | 'Flou' | 'Mur blanc' | 'Bureau';
type DemoComment = { id: number; user: string; text: string };
type Subscription = { plan: string; status: 'development' | 'active' | 'expired' | 'cancelled'; startedAt?: string; endsAt?: string; autoRenew: boolean };
type MultiLiveUser = { id: string; name: string; email: string; role?: 'admin' | 'user'; status?: 'active' | 'suspended' | 'blocked'; plan: string; subscription?: Subscription; payments: { id: string; amount: number; currency?: string; date: string; status?: string }[]; createdAt?: string; lastSeenAt?: string; connected?: boolean };
type AdminStats = { total: number; connected: number; active: number; suspended: number; blocked: number; paid: number };
type Connections = { facebook: boolean; instagram: { id?: string; username?: string }[]; instagramAuthorized?: boolean; tiktok: boolean };
const NETWORKS: { id: Network; name: string; color: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { id: 'instagram', name: 'Instagram', color: '#F078C1', icon: 'logo-instagram' },
  { id: 'tiktok', name: 'TikTok', color: '#6DE4DF', icon: 'logo-tiktok' },
  { id: 'facebook', name: 'Facebook', color: '#7DA7FF', icon: 'logo-facebook' },
];
const CONNECTION_STORE = 'multilive.connections.v1';
const CLIENT_ID_STORE = 'multilive.pwa.client.v1';
const AUTH_TOKEN_STORE = 'multilive.auth.token.v1';
const AUTH_USER_STORE = 'multilive.auth.user.v1';
const AUTH_BASE = 'https://multilive-oauth.onrender.com';
const clock = (n: number) => Math.floor(n / 60).toString().padStart(2, '0') + ':' + Math.floor(n % 60).toString().padStart(2, '0');
const DEMO_COMMENTS = [
  { user: 'Nadia', text: 'Bonsoir tout le monde 👋' },
  { user: 'Samir', text: 'La qualité est super !' },
  { user: 'Lina', text: 'Tu es en direct sur les 3 réseaux ?' },
  { user: 'Yacine', text: 'Salut depuis Alger 🔥' },
  { user: 'Maya', text: 'On entend très bien.' },
];

function CommentBubble({ comment }: { comment: DemoComment }) {
  const motion = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(motion, { toValue: 1, duration: 280, useNativeDriver: true }).start();
  }, []);
  return <Animated.View style={[s.liveComment, { opacity: motion, transform: [{ translateY: motion.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] }]}>
    <View style={s.liveAvatar}><Text style={s.liveAvatarText}>{comment.user.charAt(0)}</Text></View>
    <View style={s.commentBody}><Text style={s.commentUser}>{comment.user}</Text><Text style={s.liveCommentText}>{comment.text}</Text></View>
  </Animated.View>;
}

let segmentationLoader: Promise<any> | null = null;
function loadSegmentation() {
  if ((window as any).SelfieSegmentation) return Promise.resolve((window as any).SelfieSegmentation);
  if (segmentationLoader) return segmentationLoader;
  segmentationLoader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js';
    script.onload = () => resolve((window as any).SelfieSegmentation);
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return segmentationLoader;
}

function WebVirtualCamera({ facing, background, onError }: { facing: 'front' | 'back'; background: VirtualBackground; onError: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const backgroundRef = useRef(background);
  useEffect(() => { backgroundRef.current = background; }, [background]);
  useEffect(() => {
    let active = true; let frame = 0; let media: MediaStream | null = null; let segmenter: any;
    const office = new Image(); office.crossOrigin = 'anonymous'; office.src = 'https://images.pexels.com/photos/12526862/pexels-photo-12526862.jpeg?auto=compress&cs=tinysrgb&w=1280';
    (async () => {
      try {
        media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing === 'front' ? 'user' : 'environment', width: { ideal: 720 } }, audio: false });
        const video = videoRef.current; const canvas = canvasRef.current; if (!video || !canvas || !active) return;
        video.srcObject = media; await video.play();
        const SelfieSegmentation = await loadSegmentation(); if (!active) return;
        segmenter = new SelfieSegmentation({ locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}` });
        segmenter.setOptions({ modelSelection: 1, selfieMode: facing === 'front' });
        segmenter.onResults((result: any) => {
          const ctx = canvas.getContext('2d'); if (!ctx) return;
          canvas.width = result.image.width; canvas.height = result.image.height;
          ctx.save(); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(result.segmentationMask, 0, 0, canvas.width, canvas.height);
          ctx.globalCompositeOperation = 'source-in'; ctx.drawImage(result.image, 0, 0, canvas.width, canvas.height); ctx.globalCompositeOperation = 'destination-over';
          const selected = backgroundRef.current;
          if (selected === 'Mur blanc') { ctx.fillStyle = '#F7F7F4'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
          else if (selected === 'Bureau' && office.complete) ctx.drawImage(office, 0, 0, canvas.width, canvas.height);
          else { ctx.filter = selected === 'Flou' ? 'blur(22px)' : 'none'; ctx.drawImage(result.image, -20, -20, canvas.width + 40, canvas.height + 40); ctx.filter = 'none'; }
          ctx.restore();
        });
        const process = async () => { if (!active) return; if (video.readyState >= 2) await segmenter.send({ image: video }); frame = requestAnimationFrame(process); };
        frame = requestAnimationFrame(process);
      } catch { onError(); }
    })();
    return () => { active = false; cancelAnimationFrame(frame); media?.getTracks().forEach(track => track.stop()); segmenter?.close?.(); };
  }, [facing]);
  const transform = facing === 'front' ? 'scaleX(-1)' : undefined;
  return <>{React.createElement('video', { ref: videoRef, autoPlay: true, playsInline: true, muted: true, style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform, display: background === 'Réel' ? 'block' : 'none' } })}{React.createElement('canvas', { ref: canvasRef, style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform, display: background === 'Réel' ? 'none' : 'block' } })}</>;
}

function StudioApp() {
  const [screen, setScreen] = useState<Screen>('home');
  const [selected, setSelected] = useState<Record<Network, boolean>>({ instagram: true, tiktok: false, facebook: true });
  const [permission, requestPermission] = useCameraPermissions();
  const [camera, setCamera] = useState(false);
  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [commentsVisible, setCommentsVisible] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [previewFilter, setPreviewFilter] = useState<PreviewFilter>('Naturel');
  const [virtualBackground, setVirtualBackground] = useState<VirtualBackground>('Réel');
  const [showFilters, setShowFilters] = useState(false);
  const [guestCount, setGuestCount] = useState(0);
  const [comments, setComments] = useState<DemoComment[]>([]);
  const [viewerCount, setViewerCount] = useState(0);
  const commentCounter = useRef(0);
  const [connections, setConnections] = useState<Connections>({ facebook: false, instagram: [], instagramAuthorized: false, tiktok: false });
  const [connecting, setConnecting] = useState<Network | null>(null);
  const [user, setUser] = useState<MultiLiveUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [adminUsers, setAdminUsers] = useState<MultiLiveUser[]>([]);
  const [adminStats, setAdminStats] = useState<AdminStats>({ total: 0, connected: 0, active: 0, suspended: 0, blocked: 0, paid: 0 });
  const [adminSearch, setAdminSearch] = useState('');
  const [adminError, setAdminError] = useState('');
  const [adminBusy, setAdminBusy] = useState('');
  const startAt = useRef(0);
  const elapsedBase = useRef(0);
  const count = NETWORKS.filter(n => selected[n.id]).length;
  useEffect(() => {
    Promise.all([AsyncStorage.getItem(AUTH_TOKEN_STORE), AsyncStorage.getItem(AUTH_USER_STORE)]).then(async ([token, cachedUser]) => {
      if (cachedUser) { setUser(JSON.parse(cachedUser)); setAuthReady(true); }
      if (token) {
        const response = await fetch(`${AUTH_BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
        if (response?.ok) {
          const currentUser = (await response.json()).user; setUser(currentUser); await AsyncStorage.setItem(AUTH_USER_STORE, JSON.stringify(currentUser)); return;
        }
        await AsyncStorage.multiRemove([AUTH_TOKEN_STORE, AUTH_USER_STORE]); setUser(null);
      }
    }).catch(() => {}).finally(() => setAuthReady(true));
  }, []);
  useEffect(() => {
    if (!user) return;
    const heartbeat = setInterval(async () => {
      const token = await AsyncStorage.getItem(AUTH_TOKEN_STORE); if (!token) return;
      const response = await fetch(`${AUTH_BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
      if (!response?.ok) { await AsyncStorage.multiRemove([AUTH_TOKEN_STORE, AUTH_USER_STORE]); setUser(null); setScreen('home'); return; }
      const currentUser = (await response.json()).user; setUser(currentUser); await AsyncStorage.setItem(AUTH_USER_STORE, JSON.stringify(currentUser));
    }, 45000);
    return () => clearInterval(heartbeat);
  }, [user?.id]);
  useEffect(() => { if (screen === 'admin' && user?.role === 'admin') void loadAdmin(); }, [screen, user?.role]);
  useEffect(() => {
    AsyncStorage.getItem(CONNECTION_STORE).then(raw => {
      if (raw) setConnections(JSON.parse(raw));
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    void syncWebConnections();
    const listener = AppState.addEventListener('change', state => { if (state === 'active') void syncWebConnections(); });
    const onFocus = () => { void syncWebConnections(); };
    window.addEventListener('focus', onFocus);
    return () => { listener.remove(); window.removeEventListener('focus', onFocus); };
  }, []);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handoff = new URLSearchParams(window.location.search).get('handoff');
    if (!handoff) return;
    const pendingNetwork = sessionStorage.getItem('multilive.pendingNetwork') as Network | null;
    sessionStorage.removeItem('multilive.pendingNetwork');
    window.history.replaceState({}, '', '/');
    setConnecting(pendingNetwork || 'facebook');
    void completeConnection(handoff, pendingNetwork).finally(() => setConnecting(null));
  }, []);
  function stop() {
    if (startAt.current) {
      const duration = Math.max(0, Math.floor((Date.now() - startAt.current) / 1000));
      elapsedBase.current += duration; setElapsed(elapsedBase.current); startAt.current = 0;
    }
    setRunning(false); setPaused(false);
  }
  function pause() {
    if (!running || paused) return;
    if (startAt.current) {
      const duration = Math.max(0, Math.floor((Date.now() - startAt.current) / 1000));
      elapsedBase.current += duration; setElapsed(elapsedBase.current); startAt.current = 0;
    }
    setPaused(true);
  }
  function resume() {
    if (!running || !paused) return;
    startAt.current = Date.now(); setPaused(false);
  }
  useEffect(() => {
    if (!running || paused) return;
    const timer = setInterval(() => {
      const duration = Math.max(0, Math.floor((Date.now() - startAt.current) / 1000));
      setElapsed(elapsedBase.current + duration);
    }, 500);
    const listener = AppState.addEventListener('change', state => { if (state !== 'active') { stop(); setCamera(false); } });
    return () => { clearInterval(timer); listener.remove(); };
  }, [running, paused]);
  useEffect(() => {
    if (!running) { setComments([]); setViewerCount(0); return; }
    if (paused) return;
    const addComment = () => {
      const sample = DEMO_COMMENTS[commentCounter.current % DEMO_COMMENTS.length]!;
      const id = Date.now() + commentCounter.current++;
      setComments(current => [...current.slice(-2), { ...sample, id }]);
      setTimeout(() => setComments(current => current.filter(comment => comment.id !== id)), 6500);
    };
    addComment();
    const commentsTimer = setInterval(addComment, 2400);
    const viewersTimer = setInterval(() => setViewerCount(current => Math.min(999, current + 1 + Math.floor(Math.random() * 3))), 1800);
    return () => { clearInterval(commentsTimer); clearInterval(viewersTimer); };
  }, [running, paused]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const hide = () => { if (document.hidden) { stop(); setCamera(false); } };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, []);
  function start() {
    if (!count) return Alert.alert('Choisis un réseau', 'Active au moins une destination de test.');
    elapsedBase.current = 0; startAt.current = Date.now(); setElapsed(0); setPaused(false); setRunning(true); setScreen('studio'); void enableCamera();
  }
  async function enableCamera() {
    try {
      const result = permission?.granted ? permission : await requestPermission();
      if (result.granted) setCamera(true);
      else Alert.alert('Caméra non autorisée', 'Tu peux continuer la simulation sans caméra, ou autoriser la caméra dans les réglages du téléphone.');
    } catch { Alert.alert('Caméra indisponible', 'La simulation reste utilisable sans caméra.'); }
  }
  async function saveConnectionResult(data: any) {
      const stored = await AsyncStorage.getItem(CONNECTION_STORE);
      const previous: Connections = stored ? JSON.parse(stored) : connections;
      const updated: Connections = data.platform === 'tiktok'
        ? { ...previous, tiktok: true }
        : { ...previous, facebook: Boolean(data.connections.facebook), instagram: data.connections.instagram || [], instagramAuthorized: data.platform === 'instagram' ? true : previous.instagramAuthorized };
      setConnections(updated);
      await AsyncStorage.setItem(CONNECTION_STORE, JSON.stringify(updated));
      return updated;
  }
  async function webClientId() {
    const saved = await AsyncStorage.getItem(CLIENT_ID_STORE);
    if (saved) return saved;
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const created = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    await AsyncStorage.setItem(CLIENT_ID_STORE, created);
    return created;
  }
  async function syncWebConnections() {
    try {
      const clientId = await webClientId();
      const response = await fetch(`${AUTH_BASE}/api/mobile/status?client_id=${encodeURIComponent(clientId)}`);
      if (!response.ok) return;
      const data = await response.json();
      if (data.connections) await saveConnectionResult(data);
    } catch {}
  }
  async function completeConnection(handoff: string, requestedNetwork: Network | null) {
    try {
      const response = await fetch(`${AUTH_BASE}/api/mobile/exchange?code=${encodeURIComponent(handoff)}`);
      const data = await response.json();
      if (!response.ok || !data.connections) throw new Error(data.error || 'Compte non vérifié');
      const updated = await saveConnectionResult(data);
      const network = requestedNetwork || data.platform as Network;
      if (network) setSelected(current => ({ ...current, [network]: true }));
      setScreen('home');
      if (network === 'instagram' && !updated.instagram.length) Alert.alert('Autorisation Instagram reçue', 'Meta a accepté la connexion, mais aucun compte Instagram professionnel lié à une Page Facebook n’a été détecté. Relie ton compte Instagram Créateur/Entreprise à ta Page Facebook, puis reconnecte-le.');
      else Alert.alert('Compte connecté', network === 'instagram' && updated.instagram[0]?.username ? `@${updated.instagram[0].username} est maintenant relié à MultiLive.` : `${NETWORKS.find(item => item.id === network)?.name || 'Le compte'} est maintenant relié à MultiLive.`);
    } catch (error) {
      Alert.alert('Connexion incomplète', error instanceof Error ? error.message : 'Réessaie dans quelques instants.');
    }
  }
  async function connectNetwork(network: Network) {
    const route = network === 'facebook' ? 'meta' : network;
    const returnUrl = Platform.OS === 'web'
      ? `${window.location.origin}/auth/connected?client_id=${encodeURIComponent(await webClientId())}`
      : ExpoLinking.createURL('auth/connected');
    const url = `${AUTH_BASE}/oauth/${route}?return_to=${encodeURIComponent(returnUrl)}`;
    setConnecting(network);
    if (Platform.OS === 'web') {
      sessionStorage.setItem('multilive.pendingNetwork', network);
      window.location.assign(url);
      return;
    }
    try {
      const result = await WebBrowser.openAuthSessionAsync(url, returnUrl);
      if (result.type !== 'success') return;
      const handoff = new URL(result.url).searchParams.get('handoff');
      if (!handoff) throw new Error('Retour incomplet');
      await completeConnection(handoff, network);
    } finally { setConnecting(null); }
  }
  async function submitAuth() {
    setAuthError(''); setAuthBusy(true);
    try {
      const response = await fetch(`${AUTH_BASE}/api/auth/${authMode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: authName, email: authEmail, password: authPassword }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Connexion impossible.');
      await AsyncStorage.multiSet([[AUTH_TOKEN_STORE, data.token], [AUTH_USER_STORE, JSON.stringify(data.user)]]); setUser(data.user); setAuthPassword('');
    } catch (error) { setAuthError(error instanceof Error ? error.message : 'Connexion impossible.'); }
    finally { setAuthBusy(false); }
  }
  async function logout() {
    const token = await AsyncStorage.getItem(AUTH_TOKEN_STORE);
    if (token) await fetch(`${AUTH_BASE}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    await AsyncStorage.multiRemove([AUTH_TOKEN_STORE, AUTH_USER_STORE]); setUser(null); setScreen('home');
  }
  async function loadAdmin() {
    setAdminError('');
    const token = await AsyncStorage.getItem(AUTH_TOKEN_STORE);
    const response = await fetch(`${AUTH_BASE}/api/admin/users`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
    if (!response?.ok) return setAdminError(response ? (await response.json()).error || 'Chargement impossible.' : 'Serveur indisponible.');
    const data = await response.json(); setAdminUsers(data.users); setAdminStats(data.stats);
  }
  async function updateAdminUser(targetId: string, changes: Record<string, unknown>) {
    setAdminBusy(targetId); setAdminError('');
    try {
      const token = await AsyncStorage.getItem(AUTH_TOKEN_STORE);
      const response = await fetch(`${AUTH_BASE}/api/admin/users/${targetId}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(changes) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Modification impossible.');
      await loadAdmin();
    } catch (error) { setAdminError(error instanceof Error ? error.message : 'Modification impossible.'); }
    finally { setAdminBusy(''); }
  }
  const connected = (network: Network) => network === 'facebook' ? connections.facebook : network === 'instagram' ? connections.instagram.length > 0 : connections.tiktok;
  const subscription: Subscription = user?.subscription || { plan: user?.plan || 'development', status: 'development', startedAt: user?.id ? new Date().toISOString() : undefined, autoRenew: false };
  const subscriptionStatus = subscription.status === 'active' ? 'Actif' : subscription.status === 'expired' ? 'Expiré' : subscription.status === 'cancelled' ? 'Annulé' : 'Développement';
  const remainingDays = subscription.endsAt ? Math.max(0, Math.ceil((new Date(subscription.endsAt).getTime() - Date.now()) / 86400000)) : null;
  const dateLabel = (value?: string) => value ? new Intl.DateTimeFormat('fr-DZ', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(value)) : '—';
  const accountLabel = (network: Network) => network === 'instagram' && connections.instagram[0]?.username ? `@${connections.instagram[0].username}` : network === 'instagram' && connections.instagramAuthorized ? 'Autorisé · compte professionnel introuvable' : connected(network) ? 'Compte connecté ✓' : 'Compte non connecté';
  function go(next: Screen) { if (next !== 'studio') { stop(); setCamera(false); } setScreen(next); }
  const button = (label: string, action: () => void, secondary = false, disabled = false) => <Pressable accessibilityRole="button" disabled={disabled} onPress={action} style={({ pressed }) => [s.button, secondary && s.secondary, (pressed || disabled) && { opacity: 0.5 }]}><Text style={[s.buttonText, secondary && { color: '#F3F4F6' }]}>{label}</Text></Pressable>;
  if (!authReady) return <SafeAreaView style={s.authPage}><StatusBar barStyle="light-content" /><Text style={s.authLoading}>Ouverture de MultiLive…</Text></SafeAreaView>;
  if (!user) return <SafeAreaView style={s.authPage} edges={['top', 'bottom']}><StatusBar barStyle="light-content" /><ScrollView contentContainerStyle={s.authWrap} keyboardShouldPersistTaps="handled"><View style={s.authLogo}><Ionicons name="layers" size={31} color="#14200B" /></View><Text style={s.authBrand}>MultiLive</Text><Text style={s.authTitle}>{authMode === 'login' ? 'Bon retour parmi nous.' : 'Crée ton compte.'}</Text><Text style={s.authSubtitle}>Tes connexions, tes données et tes futurs achats seront liés à ce compte.</Text>{authMode === 'register' && <TextInput value={authName} onChangeText={setAuthName} placeholder="Nom" placeholderTextColor="#718078" autoCapitalize="words" style={s.authInput} />}<TextInput value={authEmail} onChangeText={setAuthEmail} placeholder="Adresse e-mail" placeholderTextColor="#718078" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={s.authInput} /><TextInput value={authPassword} onChangeText={setAuthPassword} placeholder="Mot de passe · 8 caractères minimum" placeholderTextColor="#718078" secureTextEntry autoCapitalize="none" style={s.authInput} />{authError ? <Text style={s.authError}>{authError}</Text> : null}<Pressable disabled={authBusy} onPress={() => { void submitAuth(); }} style={[s.authSubmit, authBusy && { opacity: 0.5 }]}><Text style={s.authSubmitText}>{authBusy ? 'Patiente…' : authMode === 'login' ? 'SE CONNECTER' : 'CRÉER MON COMPTE'}</Text></Pressable><Pressable onPress={() => { setAuthMode(value => value === 'login' ? 'register' : 'login'); setAuthError(''); }}><Text style={s.authSwitch}>{authMode === 'login' ? 'Nouveau ? Créer un compte MultiLive' : 'J’ai déjà un compte'}</Text></Pressable><Text style={s.authDev}>MODE DÉVELOPPEMENT · migration vers la base VPS à la fin</Text></ScrollView></SafeAreaView>;
  const filterTint = previewFilter === 'Chaud' ? '#FF8A3D2E' : previewFilter === 'Froid' ? '#398CFF30' : previewFilter === 'Éclat' ? '#FFF4D622' : previewFilter === 'Doux' ? '#FFB5C525' : previewFilter === 'Mono' ? '#8B93A04D' : 'transparent';
  if (screen === 'studio') return <SafeAreaView style={s.liveSafe} edges={['top', 'bottom']}><StatusBar barStyle="light-content" />
    <View style={s.liveStage}>
      {camera && permission?.granted ? Platform.OS === 'web' ? <WebVirtualCamera facing={facing} background={virtualBackground} onError={() => { setCamera(false); Alert.alert('Caméra indisponible', 'Réessaie depuis ton téléphone.'); }} /> : <CameraView style={StyleSheet.absoluteFill} facing={facing} onMountError={() => { setCamera(false); Alert.alert('Caméra indisponible', 'Réessaie depuis ton téléphone.'); }} /> : <View style={s.fullCameraPlaceholder}><Ionicons name="videocam-outline" size={54} color="#BAF473" /><Text style={s.liveTitle}>Caméra désactivée</Text><Pressable onPress={() => { void enableCamera(); }} style={s.previewButton}><Text style={s.previewButtonText}>Activer la caméra</Text></Pressable></View>}
      {previewFilter !== 'Naturel' && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: filterTint }]} />}
      <View style={s.liveShadeTop} pointerEvents="none" /><View style={s.liveShadeBottom} pointerEvents="none" />
      <View style={s.liveTopbar}>
        <Pressable accessibilityLabel="Quitter le studio" onPress={() => go('home')} style={s.glassButton}><Ionicons name="close" size={27} color="#fff" /></Pressable>
        <View style={s.liveStatus}><View style={[s.liveDot, running && { backgroundColor: paused ? '#FFC65C' : '#FF416C' }]} /><Text style={s.liveStatusText}>{running ? paused ? `PAUSE · ${clock(elapsed)}` : `TEST · ${clock(elapsed)}` : 'APERÇU'}</Text></View>
        <View style={s.liveViewers}><Ionicons name="eye" size={16} color="#fff" /><Text style={s.liveStatusText}>{running ? viewerCount : 0}</Text></View>
      </View>
      <View style={s.networkStrip}>{NETWORKS.filter(n => selected[n.id]).map(n => <View key={n.id} style={s.networkMini}><Ionicons name={n.icon} size={15} color={n.color} /><Text style={s.networkMiniText}>{n.name}</Text></View>)}</View>
      {guestCount > 0 && <View style={s.guestGrid}>{Array.from({ length: guestCount }).map((_, index) => <View key={index} style={s.guestTile}><Ionicons name="person" size={25} color="#D7DED8" /><Text style={s.guestName}>Invité {index + 1}</Text><View style={s.testGuest}><Text style={s.testGuestText}>TEST</Text></View></View>)}</View>}
      <View style={s.liveRail}>
        <Pressable accessibilityLabel="Tester le direct sur un PC" onPress={() => Platform.OS === 'web' ? window.location.assign('/live-test/?role=host') : void Linking.openURL(`${AUTH_BASE}/live-test/?role=host`)} style={s.railButton}><Ionicons name="desktop" size={22} color="#fff" /><Text style={s.railLabel}>Test PC</Text></Pressable>
        <Pressable accessibilityLabel="Changer de caméra" onPress={() => setFacing(value => value === 'front' ? 'back' : 'front')} style={s.railButton}><Ionicons name="camera-reverse" size={24} color="#fff" /><Text style={s.railLabel}>Retourner</Text></Pressable>
        <Pressable accessibilityLabel="Afficher les filtres" onPress={() => setShowFilters(value => !value)} style={[s.railButton, showFilters && s.railButtonOn]}><Ionicons name="color-wand" size={23} color="#fff" /><Text style={s.railLabel}>Filtres</Text></Pressable>
        <Pressable accessibilityLabel="Afficher ou masquer les commentaires" onPress={() => setCommentsVisible(value => !value)} style={[s.railButton, commentsVisible && s.railButtonOn]}><Ionicons name={commentsVisible ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline'} size={22} color="#fff" /><Text style={s.railLabel}>Messages</Text></Pressable>
        <Pressable accessibilityLabel="Ajouter un invité" disabled={guestCount >= 3} onPress={() => setGuestCount(value => Math.min(3, value + 1))} style={[s.railButton, guestCount >= 3 && { opacity: 0.45 }]}><Ionicons name="person-add" size={22} color="#fff" /><Text style={s.railLabel}>{guestCount + 1}/4</Text></Pressable>
        {guestCount > 0 && <Pressable accessibilityLabel="Retirer un invité" onPress={() => setGuestCount(value => Math.max(0, value - 1))} style={s.railButton}><Ionicons name="person-remove" size={22} color="#fff" /><Text style={s.railLabel}>Retirer</Text></Pressable>}
      </View>
      {commentsVisible && <View style={s.liveComments}>{comments.map(comment => <CommentBubble key={comment.id} comment={comment} />)}{!running && <View style={s.hintBubble}><Text style={s.hintText}>Les commentaires apparaîtront ici pendant le test.</Text></View>}</View>}
      {showFilters && <View style={s.filterDrawer}><Text style={s.drawerTitle}>ARRIÈRE-PLANS</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.liveFilterRow}>{(['Réel', 'Flou', 'Mur blanc', 'Bureau'] as VirtualBackground[]).map(item => <Pressable key={item} onPress={() => setVirtualBackground(item)} style={s.liveFilterItem}><View style={[s.filterPreview, virtualBackground === item && s.filterPreviewOn, { backgroundColor: item === 'Mur blanc' ? '#F4F4F0' : item === 'Bureau' ? '#8B684C' : item === 'Flou' ? '#617365' : '#25342A' }]}><Ionicons name={item === 'Bureau' ? 'business' : item === 'Mur blanc' ? 'square' : item === 'Flou' ? 'water' : 'person'} size={23} color={item === 'Mur blanc' ? '#777' : '#fff'} /></View><Text style={[s.liveFilterText, virtualBackground === item && { color: '#BAF473' }]}>{item}</Text></Pressable>)}</ScrollView><Text style={[s.drawerTitle, { marginTop: 13 }]}>COULEURS</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.liveFilterRow}>{(['Naturel', 'Éclat', 'Doux', 'Chaud', 'Froid', 'Mono'] as PreviewFilter[]).map(filter => <Pressable key={filter} onPress={() => setPreviewFilter(filter)} style={s.liveFilterItem}><View style={[s.filterPreview, previewFilter === filter && s.filterPreviewOn, { backgroundColor: filter === 'Chaud' ? '#C97341' : filter === 'Froid' ? '#4777A8' : filter === 'Éclat' ? '#E4C777' : filter === 'Doux' ? '#C77B8C' : filter === 'Mono' ? '#777' : '#8E9B86' }]}><Ionicons name="person" size={23} color="#fff" /></View><Text style={[s.liveFilterText, previewFilter === filter && { color: '#BAF473' }]}>{filter}</Text></Pressable>)}</ScrollView></View>}
      <View style={s.liveBottom}>
        <Pressable accessibilityLabel="Couper ou activer la caméra" onPress={() => camera ? setCamera(false) : void enableCamera()} style={s.bottomRound}><Ionicons name={camera ? 'videocam' : 'videocam-off'} size={23} color="#fff" /></Pressable>
        {!running ? <Pressable disabled={!count} onPress={start} style={s.goLive}><Text style={s.goLiveText}>DÉMARRER LE TEST</Text></Pressable> : <>
          <Pressable accessibilityLabel={paused ? 'Reprendre le test' : 'Mettre le test en pause'} onPress={paused ? resume : pause} style={s.pauseLive}><Ionicons name={paused ? 'play' : 'pause'} size={21} color="#14200B" /><Text style={s.pauseLiveText}>{paused ? 'REPRENDRE' : 'PAUSE'}</Text></Pressable>
          <Pressable accessibilityLabel="Arrêter le test" onPress={stop} style={s.endLive}><Ionicons name="stop" size={20} color="#fff" /><Text style={s.endLiveText}>ARRÊTER</Text></Pressable>
        </>}
        <Pressable accessibilityLabel={micEnabled ? 'Couper le micro' : 'Activer le micro'} onPress={() => setMicEnabled(value => !value)} style={[s.bottomRound, !micEnabled && s.controlOff]}><Ionicons name={micEnabled ? 'mic' : 'mic-off'} size={23} color="#fff" /></Pressable>
      </View>
      <Text style={s.simulationNotice}>MODE TEST · AUCUN FLUX N’EST ENVOYÉ</Text>
    </View>
  </SafeAreaView>;
  return <SafeAreaView style={s.safe} edges={['top', 'bottom']}><StatusBar barStyle="light-content" />
    <View style={s.header}><View style={s.mark}><Ionicons name="layers" size={23} color="#14200B" /></View><View><Text style={s.brand}>MultiLive</Text><Text style={s.small}>TON STUDIO MOBILE</Text></View><View style={s.badge}><View style={s.dot} /><Text style={s.badgeText}>SIMULATION</Text></View></View>
    <ScrollView style={s.flex} contentContainerStyle={s.page}>
      {screen === 'home' && <>
        <Text style={s.kicker}>CRÉE. CONNECTE. PARTAGE.</Text><Text style={s.hero}>{'Un seul studio.\nTous tes réseaux.'}</Text><Text style={s.description}>Prépare ton prochain live depuis ton iPhone. Aujourd’hui, on répète en mode test.</Text>
        <View style={[s.card, s.limeCard]}><View style={s.row}><Text style={s.darkLabel}>ACCÈS AU PROTOTYPE</Text><Ionicons name="infinite-outline" size={27} color="#14200B" /></View><View style={s.quotaRow}><Text style={s.quota}>ILLIMITÉ</Text></View><Text style={s.darkSub}>Aucune limite de temps · aucun paiement activé</Text></View>
        <View style={s.row}><Text style={s.section}>Tes destinations</Text><Text style={s.accent}>{count}/3 sélectionnées</Text></View>
        {NETWORKS.map(n => <View key={n.id} style={[s.network, connected(n.id) && { borderColor: n.color + '80' }]}><View style={[s.icon, { backgroundColor: n.color + '20' }]}><Ionicons name={n.icon} size={25} color={n.color} /></View><View style={s.flex}><Text style={s.networkName}>{n.name}</Text><Text style={[s.muted, connected(n.id) && { color: '#BAF473' }]}>{accountLabel(n.id)}</Text><Pressable accessibilityRole="button" disabled={connecting !== null} onPress={() => { void connectNetwork(n.id); }} style={s.connectButton}><Text style={s.connectText}>{connecting === n.id ? 'Connexion…' : connected(n.id) ? 'Reconnecter' : 'Connecter le compte'}</Text></Pressable></View><Switch accessibilityLabel={'Sélectionner ' + n.name + ' pour la simulation'} value={selected[n.id]} onValueChange={value => setSelected(v => ({ ...v, [n.id]: value }))} trackColor={{ false: '#303541', true: n.color }} /></View>)}
        {button('Ouvrir mon studio  →', () => go('studio'))}<Text style={s.footnote}>Les destinations de test ne reflètent pas une autorisation de diffusion réelle.</Text>
      </>}
      {screen === 'settings' && <>
        <Text style={s.kicker}>TON ESPACE</Text><Text style={s.hero}>{'Tout commence\npar une répétition.'}</Text>
        <View style={s.card}><Text style={s.section}>{user.name}</Text><Text style={s.description}>{user.email}</Text><Text style={s.muted}>Compte MultiLive · formule développement</Text></View>
        <View style={s.card}><Text style={s.section}>Mes comptes</Text>{NETWORKS.map(n => <View key={n.id} style={s.row}><Text style={s.description}>{n.name}</Text><Text style={[s.muted, connected(n.id) && { color: '#BAF473' }]}>{accountLabel(n.id)}</Text></View>)}{button('Gérer mes connexions', () => go('home'), true)}</View>
        <View style={s.card}><View style={s.row}><View><Text style={s.section}>Mon abonnement</Text><Text style={s.description}>Formule {subscription.plan === 'development' ? 'développement' : subscription.plan}</Text></View><View style={s.statusPill}><Text style={s.statusPillText}>{subscriptionStatus}</Text></View></View><Text style={s.muted}>{remainingDays === null ? 'Accès illimité pendant le développement.' : `${remainingDays} jour(s) restant(s).`}</Text>{button('Voir et gérer mon abonnement', () => go('subscription'), true)}</View>
        <View style={s.card}><Text style={s.section}>Ta confidentialité</Text><Text style={s.description}>Ton mot de passe est transformé en empreinte sécurisée et n’est jamais lisible. Aucune vidéo n’est enregistrée pendant la simulation.</Text><Text style={s.muted}>Pendant le développement, les données du compte sont temporaires sur Render.</Text></View>
        <View style={s.card}><Text style={s.section}>Historique des paiements</Text><Text style={s.description}>{user.payments.length ? `${user.payments.length} paiement(s) enregistré(s).` : 'Aucun paiement pour le moment.'}</Text><Text style={s.muted}>Les paiements seront activés uniquement lorsque l’application sera terminée.</Text></View>
        {button('Se déconnecter', () => { void logout(); }, true)}
      </>}
      {screen === 'subscription' && <>
        <Text style={s.kicker}>MON ABONNEMENT</Text><Text style={s.hero}>{'Ton accès,\nen un coup d’œil.'}</Text>
        <View style={[s.card, s.limeCard]}><View style={s.row}><Text style={s.darkLabel}>FORMULE ACTUELLE</Text><Ionicons name="shield-checkmark" size={27} color="#14200B" /></View><Text style={s.subscriptionPlan}>{subscription.plan === 'development' ? 'DÉVELOPPEMENT' : subscription.plan.toUpperCase()}</Text><Text style={s.darkSub}>{subscription.status === 'development' ? 'Accès gratuit et illimité pendant la construction de MultiLive.' : `${remainingDays ?? 0} jour(s) restant(s)`}</Text></View>
        <View style={s.card}><Text style={s.section}>Détails</Text><View style={s.detailRow}><Text style={s.muted}>État</Text><Text style={s.detailValue}>{subscriptionStatus}</Text></View><View style={s.detailRow}><Text style={s.muted}>Début</Text><Text style={s.detailValue}>{dateLabel(subscription.startedAt)}</Text></View><View style={s.detailRow}><Text style={s.muted}>Expiration</Text><Text style={s.detailValue}>{dateLabel(subscription.endsAt)}</Text></View><View style={s.detailRow}><Text style={s.muted}>Renouvellement automatique</Text><Text style={s.detailValue}>{subscription.autoRenew ? 'Oui' : 'Non'}</Text></View></View>
        <View style={s.card}><Text style={s.section}>Choisir une durée</Text><Text style={s.description}>1 mois · 3 mois · 12 mois</Text><View style={s.currencyRow}><View style={s.currencyChip}><Text style={s.currencyText}>🇩🇿 DZD · CIB / EDAHABIA</Text></View><View style={s.currencyChip}><Text style={s.currencyText}>🌍 Devise · Carte internationale</Text></View></View><Text style={s.warning}>Paiement bientôt disponible. Aucun débit ne peut être effectué aujourd’hui.</Text></View>
        <View style={s.card}><Text style={s.section}>Historique</Text>{user.payments.length ? user.payments.map(payment => <View key={payment.id} style={s.detailRow}><View><Text style={s.detailValue}>{payment.amount} {payment.currency || 'DZD'}</Text><Text style={s.muted}>{dateLabel(payment.date)}</Text></View><Text style={s.paymentOk}>{payment.status === 'failed' ? 'Échoué' : 'Payé'}</Text></View>) : <Text style={s.description}>Aucun paiement pour le moment.</Text>}</View>
        {button('Retour à mon espace', () => go('settings'), true)}
      </>}
      {screen === 'admin' && user.role === 'admin' && <>
        <Text style={s.kicker}>ADMINISTRATION</Text><Text style={s.hero}>{'Pilote toute\nl’application.'}</Text>
        <View style={s.statsGrid}><View style={s.statCard}><Text style={s.statNumber}>{adminStats.total}</Text><Text style={s.statLabel}>INSCRITS</Text></View><View style={s.statCard}><Text style={s.statNumber}>{adminStats.connected}</Text><Text style={s.statLabel}>CONNECTÉS</Text></View><View style={s.statCard}><Text style={s.statNumber}>{adminStats.paid}</Text><Text style={s.statLabel}>OFFRE PRO</Text></View><View style={s.statCard}><Text style={s.statNumber}>{adminStats.suspended + adminStats.blocked}</Text><Text style={s.statLabel}>RESTREINTS</Text></View></View>
        <TextInput value={adminSearch} onChangeText={setAdminSearch} placeholder="Rechercher un nom ou un e-mail" placeholderTextColor="#718078" autoCapitalize="none" style={s.authInput} />
        {adminError ? <Text style={s.authError}>{adminError}</Text> : null}
        {adminUsers.filter(item => `${item.name} ${item.email}`.toLowerCase().includes(adminSearch.toLowerCase())).map(item => <View key={item.id} style={s.adminUserCard}><View style={s.row}><View style={s.flex}><Text style={s.networkName}>{item.name}</Text><Text style={s.muted}>{item.email}</Text></View><View style={[s.statusPill, item.status === 'blocked' && s.statusBlocked, item.status === 'suspended' && s.statusSuspended]}><Text style={s.statusPillText}>{item.connected ? '● EN LIGNE' : (item.status || 'active').toUpperCase()}</Text></View></View><View style={s.detailRow}><Text style={s.muted}>Offre</Text><Text style={s.detailValue}>{item.plan === 'development' ? 'Développement' : item.plan.toUpperCase()}</Text></View><Text style={s.adminLabel}>ATTRIBUER UNE OFFRE</Text><View style={s.actionWrap}><Pressable disabled={adminBusy === item.id} onPress={() => void updateAdminUser(item.id, { plan: 'development' })} style={s.adminAction}><Text style={s.adminActionText}>Développement</Text></Pressable><Pressable disabled={adminBusy === item.id} onPress={() => void updateAdminUser(item.id, { plan: 'free' })} style={s.adminAction}><Text style={s.adminActionText}>Gratuit</Text></Pressable><Pressable disabled={adminBusy === item.id} onPress={() => void updateAdminUser(item.id, { plan: 'pro', durationMonths: 1 })} style={s.adminAction}><Text style={s.adminActionText}>Pro 1 mois</Text></Pressable><Pressable disabled={adminBusy === item.id} onPress={() => void updateAdminUser(item.id, { plan: 'pro', durationMonths: 3 })} style={s.adminAction}><Text style={s.adminActionText}>Pro 3 mois</Text></Pressable><Pressable disabled={adminBusy === item.id} onPress={() => void updateAdminUser(item.id, { plan: 'pro', durationMonths: 12 })} style={s.adminAction}><Text style={s.adminActionText}>Pro 12 mois</Text></Pressable></View><Text style={s.adminLabel}>ACCÈS AU COMPTE</Text><View style={s.actionWrap}><Pressable disabled={adminBusy === item.id} onPress={() => void updateAdminUser(item.id, { status: 'active' })} style={[s.adminAction, s.allowAction]}><Text style={s.allowActionText}>Autoriser</Text></Pressable><Pressable disabled={adminBusy === item.id} onPress={() => void updateAdminUser(item.id, { status: 'suspended' })} style={[s.adminAction, s.suspendAction]}><Text style={s.adminActionText}>Suspendre</Text></Pressable><Pressable disabled={adminBusy === item.id} onPress={() => void updateAdminUser(item.id, { status: 'blocked' })} style={[s.adminAction, s.blockAction]}><Text style={s.adminActionText}>Bloquer</Text></Pressable></View>{adminBusy === item.id && <Text style={s.muted}>Mise à jour…</Text>}</View>)}
      </>}
    </ScrollView>
    <View style={s.nav}>{([...([{ id: 'home', title: 'Accueil', icon: 'grid-outline' }, { id: 'studio', title: 'Studio', icon: 'videocam-outline' }, { id: 'settings', title: 'Mon espace', icon: 'person-circle-outline' }] as const), ...(user.role === 'admin' ? [{ id: 'admin' as const, title: 'Admin', icon: 'shield-checkmark-outline' as const }] : [])]).map(tab => <Pressable key={tab.id} accessibilityRole="tab" accessibilityState={{ selected: screen === tab.id }} onPress={() => go(tab.id)} style={s.navItem}><Ionicons name={tab.icon} size={23} color={screen === tab.id ? '#BAF473' : '#818996'} /><Text style={[s.navText, screen === tab.id && { color: '#BAF473' }]}>{tab.title}</Text></Pressable>)}</View>
  </SafeAreaView>;
}
export default function App() { return <SafeAreaProvider><StudioApp /></SafeAreaProvider>; }
const s = StyleSheet.create({
  authPage: { flex: 1, backgroundColor: '#0C100E' },
  authWrap: { flexGrow: 1, width: '100%', maxWidth: 500, alignSelf: 'center', justifyContent: 'center', padding: 26, gap: 14 },
  authLogo: { width: 62, height: 62, borderRadius: 21, backgroundColor: '#BAF473', alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  authBrand: { color: '#BAF473', fontSize: 14, fontWeight: '900', letterSpacing: 2 },
  authTitle: { color: '#F5F6F3', fontSize: 34, lineHeight: 39, fontWeight: '900', letterSpacing: -1 },
  authSubtitle: { color: '#9DA79F', fontSize: 14, lineHeight: 21, marginBottom: 9 },
  authInput: { minHeight: 55, borderRadius: 17, borderWidth: 1, borderColor: '#344038', backgroundColor: '#151B17', color: '#FFFFFF', paddingHorizontal: 16, fontSize: 15 },
  authSubmit: { minHeight: 56, borderRadius: 18, backgroundColor: '#BAF473', alignItems: 'center', justifyContent: 'center', marginTop: 3 },
  authSubmitText: { color: '#14200B', fontSize: 13, fontWeight: '900', letterSpacing: 0.7 },
  authSwitch: { color: '#BAF473', fontSize: 13, fontWeight: '800', textAlign: 'center', paddingVertical: 9 },
  authError: { color: '#FF8199', fontSize: 12, lineHeight: 18 },
  authDev: { color: '#69756D', fontSize: 9, textAlign: 'center', letterSpacing: 0.7, marginTop: 7 },
  authLoading: { color: '#BAF473', fontSize: 15, fontWeight: '800', margin: 'auto' },
  liveSafe: { flex: 1, backgroundColor: '#050706' },
  liveStage: { flex: 1, backgroundColor: '#0C110E', overflow: 'hidden' },
  fullCameraPlaceholder: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: 15, backgroundColor: '#111A14' },
  liveTitle: { color: '#F7F8F5', fontSize: 22, fontWeight: '800' },
  previewButton: { backgroundColor: '#BAF473', borderRadius: 18, paddingHorizontal: 18, paddingVertical: 12 },
  previewButtonText: { color: '#14200B', fontSize: 13, fontWeight: '900' },
  liveShadeTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 150, backgroundColor: '#00000055' },
  liveShadeBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 310, backgroundColor: '#00000073' },
  liveTopbar: { position: 'absolute', top: 13, left: 13, right: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  glassButton: { width: 43, height: 43, borderRadius: 22, backgroundColor: '#101511B8', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FFFFFF24' },
  liveStatus: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#101511B8', borderRadius: 22, paddingHorizontal: 13, height: 39, borderWidth: 1, borderColor: '#FFFFFF1F' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#BAF473' },
  liveStatusText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900', letterSpacing: 0.5 },
  liveViewers: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#101511B8', borderRadius: 22, paddingHorizontal: 12, height: 39, borderWidth: 1, borderColor: '#FFFFFF1F' },
  networkStrip: { position: 'absolute', top: 67, left: 13, flexDirection: 'row', gap: 7, flexWrap: 'wrap', maxWidth: '76%' },
  networkMini: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, height: 29, borderRadius: 15, backgroundColor: '#101511B8', borderWidth: 1, borderColor: '#FFFFFF1F' },
  networkMiniText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
  guestGrid: { position: 'absolute', top: 106, right: 12, width: 112, gap: 8 },
  guestTile: { height: 88, borderRadius: 17, backgroundColor: '#26302AAE', borderWidth: 1, borderColor: '#FFFFFF35', alignItems: 'center', justifyContent: 'center', gap: 4, overflow: 'hidden' },
  guestName: { color: '#F1F4F1', fontSize: 10, fontWeight: '800' },
  testGuest: { position: 'absolute', top: 6, right: 6, borderRadius: 7, backgroundColor: '#BAF473', paddingHorizontal: 5, paddingVertical: 2 },
  testGuestText: { color: '#14200B', fontSize: 7, fontWeight: '900' },
  liveRail: { position: 'absolute', right: 11, bottom: 174, alignItems: 'center', gap: 14 },
  railButton: { width: 56, minHeight: 55, borderRadius: 18, backgroundColor: '#101511B8', alignItems: 'center', justifyContent: 'center', gap: 3, borderWidth: 1, borderColor: '#FFFFFF20' },
  railButtonOn: { backgroundColor: '#597C42D9', borderColor: '#BAF473' },
  railLabel: { color: '#FFFFFF', fontSize: 8, fontWeight: '800' },
  liveComments: { position: 'absolute', left: 12, right: 78, bottom: 153, gap: 7, alignItems: 'flex-start' },
  hintBubble: { backgroundColor: '#101511C9', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 15, maxWidth: 265 },
  hintText: { color: '#E0E6E1', fontSize: 10, lineHeight: 15 },
  filterDrawer: { position: 'absolute', left: 0, right: 0, bottom: 105, backgroundColor: '#0B100DDE', paddingTop: 13, paddingBottom: 12, borderTopWidth: 1, borderColor: '#FFFFFF24' },
  drawerTitle: { color: '#FFFFFF', fontSize: 10, fontWeight: '900', letterSpacing: 1.4, paddingHorizontal: 16, marginBottom: 11 },
  liveFilterRow: { paddingHorizontal: 14, gap: 13 },
  liveFilterItem: { alignItems: 'center', gap: 5 },
  filterPreview: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF3B' },
  filterPreviewOn: { borderColor: '#BAF473', borderWidth: 3 },
  liveFilterText: { color: '#E3E8E4', fontSize: 9, fontWeight: '800' },
  liveBottom: { position: 'absolute', left: 14, right: 14, bottom: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  bottomRound: { width: 49, height: 49, borderRadius: 25, backgroundColor: '#101511D9', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FFFFFF2A' },
  goLive: { minWidth: 178, height: 52, borderRadius: 27, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#BAF473' },
  stopLive: { backgroundColor: '#FF416C' },
  goLiveText: { color: '#14200B', fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  pauseLive: { height: 49, borderRadius: 25, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: '#BAF473' },
  pauseLiveText: { color: '#14200B', fontSize: 9, fontWeight: '900' },
  endLive: { height: 49, borderRadius: 25, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: '#FF416C' },
  endLiveText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' },
  controlOff: { backgroundColor: '#7B2437', borderColor: '#FF7895' },
  simulationNotice: { position: 'absolute', left: 0, right: 0, bottom: 10, color: '#D1D7D2', fontSize: 8, fontWeight: '800', letterSpacing: 0.8, textAlign: 'center' },
  liveComment: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#101511D9', borderRadius: 17, paddingHorizontal: 10, paddingVertical: 8, maxWidth: 285, borderWidth: 1, borderColor: '#FFFFFF19' },
  liveAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#BAF473', alignItems: 'center', justifyContent: 'center' },
  liveAvatarText: { color: '#14200B', fontSize: 12, fontWeight: '900' },
  commentBody: { flexShrink: 1 },
  commentUser: { color: '#BAF473', fontSize: 9, fontWeight: '900' },
  liveCommentText: { color: '#FFFFFF', fontSize: 11, lineHeight: 15 },
  safe: { flex: 1, backgroundColor: '#0C100E' }, flex: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', padding: 19, gap: 11, borderBottomWidth: 1, borderColor: '#222A24' }, mark: { width: 43, height: 43, borderRadius: 15, backgroundColor: '#BAF473', alignItems: 'center', justifyContent: 'center' }, brand: { color: '#F5F6F3', fontSize: 23, fontWeight: '800', letterSpacing: -0.7 }, small: { color: '#818C84', fontSize: 9, letterSpacing: 1.8, marginTop: 3 }, badge: { marginLeft: 'auto', backgroundColor: '#273020', paddingHorizontal: 9, paddingVertical: 8, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 5 }, badgeText: { color: '#D2E5BD', fontSize: 9, fontWeight: '800', letterSpacing: 0.6 }, dot: { width: 5, height: 5, backgroundColor: '#BAF473', borderRadius: 3 }, page: { padding: 21, gap: 17, paddingBottom: 30, maxWidth: 520, width: '100%', alignSelf: 'center' }, kicker: { color: '#BAF473', fontSize: 10, fontWeight: '800', letterSpacing: 2, marginTop: 10 }, hero: { color: '#F4F5EE', fontSize: 36, lineHeight: 40, fontWeight: '800', letterSpacing: -1.4 }, description: { color: '#9DA79F', fontSize: 14, lineHeight: 22 }, card: { backgroundColor: '#161D18', borderWidth: 1, borderColor: '#2A342C', borderRadius: 23, padding: 19, gap: 14 }, limeCard: { backgroundColor: '#BAF473', borderColor: '#BAF473', marginVertical: 6 }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, darkLabel: { color: '#24351B', fontSize: 10, letterSpacing: 1.7, fontWeight: '800' }, quotaRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 }, quota: { fontSize: 48, fontWeight: '800', color: '#16200E', letterSpacing: -2 }, darkSub: { color: '#3C512A', fontSize: 11 }, track: { height: 5, backgroundColor: '#A2D264', borderRadius: 4, overflow: 'hidden' }, progress: { height: 5, backgroundColor: '#263D19', borderRadius: 4 }, section: { fontSize: 19, color: '#F4F5EE', fontWeight: '700', letterSpacing: -0.5 }, accent: { fontSize: 12, color: '#BAF473', fontWeight: '700' }, statusPill: { backgroundColor: '#263821', borderRadius: 18, paddingHorizontal: 10, paddingVertical: 7 }, statusPillText: { color: '#BAF473', fontSize: 9, fontWeight: '900' }, statusBlocked: { backgroundColor: '#571D28' }, statusSuspended: { backgroundColor: '#654718' }, subscriptionPlan: { color: '#14200B', fontSize: 31, fontWeight: '900', letterSpacing: -1 }, detailRow: { minHeight: 39, borderBottomWidth: 1, borderColor: '#2B352E', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14, paddingBottom: 9 }, detailValue: { color: '#F1F4F1', fontSize: 12, fontWeight: '800', textAlign: 'right' }, currencyRow: { gap: 8 }, currencyChip: { backgroundColor: '#202A22', borderWidth: 1, borderColor: '#3B493D', borderRadius: 14, padding: 12 }, currencyText: { color: '#DCE4DE', fontSize: 11, fontWeight: '800' }, paymentOk: { color: '#BAF473', fontSize: 11, fontWeight: '900' }, statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 }, statCard: { width: '48%', minHeight: 92, backgroundColor: '#161D18', borderWidth: 1, borderColor: '#2A342C', borderRadius: 19, padding: 15, justifyContent: 'center' }, statNumber: { color: '#BAF473', fontSize: 30, fontWeight: '900' }, statLabel: { color: '#89958C', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 }, adminUserCard: { backgroundColor: '#161D18', borderWidth: 1, borderColor: '#2A342C', borderRadius: 23, padding: 17, gap: 13 }, adminLabel: { color: '#89958C', fontSize: 9, fontWeight: '900', letterSpacing: 1.3, marginTop: 2 }, actionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, adminAction: { borderWidth: 1, borderColor: '#435044', backgroundColor: '#232C25', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 9 }, adminActionText: { color: '#E9EEE9', fontSize: 10, fontWeight: '800' }, allowAction: { backgroundColor: '#BAF473', borderColor: '#BAF473' }, allowActionText: { color: '#14200B', fontSize: 10, fontWeight: '900' }, suspendAction: { borderColor: '#A9782E' }, blockAction: { borderColor: '#B33B52', backgroundColor: '#491923' }, network: { borderWidth: 1, borderColor: '#29322C', borderRadius: 20, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: '#151B17' }, icon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, networkName: { color: '#F4F5EE', fontSize: 16, fontWeight: '700' }, muted: { color: '#89958C', fontSize: 11, lineHeight: 17, marginTop: 3 }, connectButton: { alignSelf: 'flex-start', marginTop: 8, borderRadius: 10, borderWidth: 1, borderColor: '#56634F', paddingHorizontal: 10, paddingVertical: 7 }, connectText: { color: '#BAF473', fontSize: 11, fontWeight: '800' }, button: { backgroundColor: '#BAF473', borderRadius: 17, minHeight: 53, paddingHorizontal: 17, justifyContent: 'center', alignItems: 'center' }, secondary: { backgroundColor: '#29342A', borderWidth: 1, borderColor: '#40513B' }, buttonText: { color: '#16200E', fontWeight: '800', fontSize: 14 }, footnote: { color: '#8B978E', fontSize: 11, lineHeight: 17, textAlign: 'center' }, camera: { aspectRatio: 3 / 4, backgroundColor: '#161E19', borderRadius: 26, overflow: 'hidden', borderWidth: 1, borderColor: '#354335' }, cameraPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 22, gap: 19 }, cameraOrb: { width: 85, height: 85, backgroundColor: '#263821', borderRadius: 43, justifyContent: 'center', alignItems: 'center' }, cameraBadge: { position: 'absolute', top: 17, left: 17, backgroundColor: '#142016D9', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 20 }, cameraControls: { position: 'absolute', bottom: 18, left: 0, right: 0, justifyContent: 'center', flexDirection: 'row', gap: 16 }, round: { backgroundColor: '#102016CC', padding: 13, borderRadius: 30 }, filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }, filterChip: { backgroundColor: '#1A211C', borderWidth: 1, borderColor: '#354039', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 }, filterChipOn: { backgroundColor: '#BAF473', borderColor: '#BAF473' }, filterText: { color: '#A8B0AA', fontSize: 11, fontWeight: '700' }, filterTextOn: { color: '#16200E' }, livePanel: { backgroundColor: '#141B16', borderWidth: 1, borderColor: '#2A352D', borderRadius: 21, padding: 16, gap: 14 }, viewerBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#253022', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 18 }, viewerText: { color: '#D4E8C2', fontSize: 11, fontWeight: '800' }, comment: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#0F1511', padding: 12, borderRadius: 14 }, avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#263322', justifyContent: 'center', alignItems: 'center' }, commentText: { flex: 1, color: '#929D95', fontSize: 11, lineHeight: 17 }, pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, pill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#1D2820', borderRadius: 20, padding: 9 }, pillText: { color: '#C6CEC8', fontSize: 10 }, nav: { borderTopWidth: 1, borderColor: '#28312A', flexDirection: 'row', backgroundColor: '#101712', paddingVertical: 12 }, navItem: { flex: 1, alignItems: 'center', gap: 5 }, navText: { color: '#818996', fontSize: 10, fontWeight: '700' }, warning: { color: '#FFC281', fontSize: 12 },
});
