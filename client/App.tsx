import React, { useEffect, useRef, useState } from 'react';
import { Animated, AppState, Alert, Linking, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as ExpoLinking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

type Screen = 'home' | 'studio' | 'settings';
type Network = 'instagram' | 'tiktok' | 'facebook';
type PreviewFilter = 'Naturel' | 'Éclat' | 'Doux' | 'Chaud' | 'Froid' | 'Mono';
type DemoComment = { id: number; user: string; text: string };
type Connections = { facebook: boolean; instagram: { id?: string; username?: string }[]; tiktok: boolean };
const NETWORKS: { id: Network; name: string; color: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { id: 'instagram', name: 'Instagram', color: '#F078C1', icon: 'logo-instagram' },
  { id: 'tiktok', name: 'TikTok', color: '#6DE4DF', icon: 'logo-tiktok' },
  { id: 'facebook', name: 'Facebook', color: '#7DA7FF', icon: 'logo-facebook' },
];
const LIMIT = 1200;
const STORE = 'multilive.simulation.usage.v1';
const CONNECTION_STORE = 'multilive.connections.v1';
const CLIENT_ID_STORE = 'multilive.pwa.client.v1';
const AUTH_BASE = 'https://multilive-oauth.onrender.com';
const day = () => { const d = new Date(); return [d.getFullYear(), d.getMonth() + 1, d.getDate()].join('-'); };
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
  const [used, setUsed] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [previewFilter, setPreviewFilter] = useState<PreviewFilter>('Naturel');
  const [showFilters, setShowFilters] = useState(false);
  const [guestCount, setGuestCount] = useState(0);
  const [comments, setComments] = useState<DemoComment[]>([]);
  const [viewerCount, setViewerCount] = useState(0);
  const commentCounter = useRef(0);
  const [connections, setConnections] = useState<Connections>({ facebook: false, instagram: [], tiktok: false });
  const [connecting, setConnecting] = useState<Network | null>(null);
  const usage = useRef({ date: day(), seconds: 0 });
  const startAt = useRef(0);
  const baseUsed = useRef(0);
  const elapsedBase = useRef(0);
  const count = NETWORKS.filter(n => selected[n.id]).length;
  const persist = () => AsyncStorage.setItem(STORE, JSON.stringify(usage.current)).catch(() => setStorageError(true));
  useEffect(() => {
    AsyncStorage.getItem(STORE).then(raw => {
      if (raw) { const saved = JSON.parse(raw); if (saved.date === day() && Number.isFinite(saved.seconds)) usage.current.seconds = Math.max(0, Math.min(LIMIT, saved.seconds)); }
      setUsed(usage.current.seconds);
    }).catch(() => setStorageError(true)).finally(() => setReady(true));
  }, []);
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
      usage.current = { date: day(), seconds: Math.min(LIMIT, baseUsed.current + duration) };
      elapsedBase.current += duration; setElapsed(elapsedBase.current); setUsed(usage.current.seconds); startAt.current = 0; void persist();
    }
    setRunning(false); setPaused(false);
  }
  function pause() {
    if (!running || paused) return;
    if (startAt.current) {
      const duration = Math.max(0, Math.floor((Date.now() - startAt.current) / 1000));
      usage.current = { date: day(), seconds: Math.min(LIMIT, baseUsed.current + duration) };
      elapsedBase.current += duration; setElapsed(elapsedBase.current); setUsed(usage.current.seconds); startAt.current = 0; void persist();
    }
    setPaused(true);
  }
  function resume() {
    if (!running || !paused || usage.current.seconds >= LIMIT) return;
    baseUsed.current = usage.current.seconds; startAt.current = Date.now(); setPaused(false);
  }
  useEffect(() => {
    if (!running || paused) return;
    const timer = setInterval(() => {
      if (usage.current.date !== day()) { usage.current = { date: day(), seconds: 0 }; baseUsed.current = 0; startAt.current = Date.now(); }
      const duration = Math.max(0, Math.floor((Date.now() - startAt.current) / 1000));
      const total = Math.min(LIMIT, baseUsed.current + duration);
      usage.current.seconds = total; setUsed(total); setElapsed(elapsedBase.current + duration);
      if (duration % 5 === 0) void persist();
      if (total >= LIMIT) stop();
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
    if (usage.current.date !== day()) usage.current = { date: day(), seconds: 0 };
    if (usage.current.seconds >= LIMIT) return Alert.alert('Essai terminé', 'Les 20 minutes de simulation du jour sont utilisées. Aucun paiement activé.');
    baseUsed.current = usage.current.seconds; elapsedBase.current = 0; startAt.current = Date.now(); setElapsed(0); setPaused(false); setRunning(true); setScreen('studio'); void enableCamera();
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
        : { ...previous, facebook: Boolean(data.connections.facebook), instagram: data.connections.instagram || [] };
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
      Alert.alert('Compte connecté', network === 'instagram' && updated.instagram[0]?.username ? `@${updated.instagram[0].username} est maintenant relié à MultiLive.` : `${NETWORKS.find(item => item.id === network)?.name || 'Le compte'} est maintenant relié à MultiLive.`);
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
  const connected = (network: Network) => network === 'facebook' ? connections.facebook : network === 'instagram' ? connections.instagram.length > 0 : connections.tiktok;
  const accountLabel = (network: Network) => network === 'instagram' && connections.instagram[0]?.username ? `@${connections.instagram[0].username}` : connected(network) ? 'Compte connecté ✓' : 'Compte non connecté';
  function go(next: Screen) { if (next !== 'studio') { stop(); setCamera(false); } setScreen(next); }
  const button = (label: string, action: () => void, secondary = false, disabled = false) => <Pressable accessibilityRole="button" disabled={disabled} onPress={action} style={({ pressed }) => [s.button, secondary && s.secondary, (pressed || disabled) && { opacity: 0.5 }]}><Text style={[s.buttonText, secondary && { color: '#F3F4F6' }]}>{label}</Text></Pressable>;
  const filterTint = previewFilter === 'Chaud' ? '#FF8A3D2E' : previewFilter === 'Froid' ? '#398CFF30' : previewFilter === 'Éclat' ? '#FFF4D622' : previewFilter === 'Doux' ? '#FFB5C525' : previewFilter === 'Mono' ? '#8B93A04D' : 'transparent';
  if (screen === 'studio') return <SafeAreaView style={s.liveSafe} edges={['top', 'bottom']}><StatusBar barStyle="light-content" />
    <View style={s.liveStage}>
      {camera && permission?.granted ? <CameraView style={StyleSheet.absoluteFill} facing={facing} onMountError={() => { setCamera(false); Alert.alert('Caméra indisponible', 'Réessaie depuis ton téléphone.'); }} /> : <View style={s.fullCameraPlaceholder}><Ionicons name="videocam-outline" size={54} color="#BAF473" /><Text style={s.liveTitle}>Caméra désactivée</Text><Pressable onPress={() => { void enableCamera(); }} style={s.previewButton}><Text style={s.previewButtonText}>Activer la caméra</Text></Pressable></View>}
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
      {showFilters && <View style={s.filterDrawer}><Text style={s.drawerTitle}>FILTRES MULTILIVE</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.liveFilterRow}>{(['Naturel', 'Éclat', 'Doux', 'Chaud', 'Froid', 'Mono'] as PreviewFilter[]).map(filter => <Pressable key={filter} onPress={() => setPreviewFilter(filter)} style={s.liveFilterItem}><View style={[s.filterPreview, previewFilter === filter && s.filterPreviewOn, { backgroundColor: filter === 'Chaud' ? '#C97341' : filter === 'Froid' ? '#4777A8' : filter === 'Éclat' ? '#E4C777' : filter === 'Doux' ? '#C77B8C' : filter === 'Mono' ? '#777' : '#8E9B86' }]}><Ionicons name="person" size={23} color="#fff" /></View><Text style={[s.liveFilterText, previewFilter === filter && { color: '#BAF473' }]}>{filter}</Text></Pressable>)}</ScrollView></View>}
      <View style={s.liveBottom}>
        <Pressable accessibilityLabel="Couper ou activer la caméra" onPress={() => camera ? setCamera(false) : void enableCamera()} style={s.bottomRound}><Ionicons name={camera ? 'videocam' : 'videocam-off'} size={23} color="#fff" /></Pressable>
        {!running ? <Pressable disabled={!ready || !count || used >= LIMIT} onPress={start} style={s.goLive}><Text style={s.goLiveText}>DÉMARRER LE TEST</Text></Pressable> : <>
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
        <View style={[s.card, s.limeCard]}><View style={s.row}><Text style={s.darkLabel}>TON ESSAI DU JOUR</Text><Ionicons name="time-outline" size={23} color="#14200B" /></View><View style={s.quotaRow}><Text style={s.quota}>{clock(LIMIT - used)}</Text><Text style={s.darkSub}>restantes / 20 min</Text></View><View style={s.track}><View style={[s.progress, { width: ((LIMIT - used) / LIMIT * 100) + '%' as `${number}%` }]} /></View><Text style={s.darkSub}>Compteur de simulation · aucun paiement</Text></View>
        <View style={s.row}><Text style={s.section}>Tes destinations</Text><Text style={s.accent}>{count}/3 sélectionnées</Text></View>
        {NETWORKS.map(n => <View key={n.id} style={[s.network, connected(n.id) && { borderColor: n.color + '80' }]}><View style={[s.icon, { backgroundColor: n.color + '20' }]}><Ionicons name={n.icon} size={25} color={n.color} /></View><View style={s.flex}><Text style={s.networkName}>{n.name}</Text><Text style={[s.muted, connected(n.id) && { color: '#BAF473' }]}>{accountLabel(n.id)}</Text><Pressable accessibilityRole="button" disabled={connecting !== null} onPress={() => { void connectNetwork(n.id); }} style={s.connectButton}><Text style={s.connectText}>{connecting === n.id ? 'Connexion…' : connected(n.id) ? 'Reconnecter' : 'Connecter le compte'}</Text></Pressable></View><Switch accessibilityLabel={'Sélectionner ' + n.name + ' pour la simulation'} value={selected[n.id]} onValueChange={value => setSelected(v => ({ ...v, [n.id]: value }))} trackColor={{ false: '#303541', true: n.color }} /></View>)}
        {button('Ouvrir mon studio  →', () => go('studio'))}<Text style={s.footnote}>Les destinations de test ne reflètent pas une autorisation de diffusion réelle.</Text>
      </>}
      {screen === 'settings' && <>
        <Text style={s.kicker}>TON ESPACE</Text><Text style={s.hero}>{'Tout commence\npar une répétition.'}</Text>
        <View style={s.card}><Text style={s.section}>Mes comptes</Text>{NETWORKS.map(n => <View key={n.id} style={s.row}><Text style={s.description}>{n.name}</Text><Text style={[s.muted, connected(n.id) && { color: '#BAF473' }]}>{accountLabel(n.id)}</Text></View>)}{button('Gérer mes connexions', () => go('home'), true)}</View>
        <View style={s.card}><Text style={s.section}>20 minutes offertes par jour</Text><Text style={s.description}>On teste le compteur. Aucun abonnement ni paiement activé.</Text><Text style={s.muted}>Compteur local au téléphone, pas une protection commerciale.</Text></View>
        <View style={s.card}><Text style={s.section}>Ta confidentialité</Text><Text style={s.description}>Aucun mot de passe demandé. Aucune vidéo enregistrée ou envoyée pendant la simulation.</Text><Text style={s.muted}>Seul le temps de test est mémorisé sur cet appareil.</Text></View>
      </>}
      {storageError && <Text style={s.warning}>Le temps de test ne peut pas être mémorisé sur cet appareil.</Text>}
    </ScrollView>
    <View style={s.nav}>{([{ id: 'home', title: 'Accueil', icon: 'grid-outline' }, { id: 'studio', title: 'Studio', icon: 'videocam-outline' }, { id: 'settings', title: 'Mon espace', icon: 'person-circle-outline' }] as const).map(tab => <Pressable key={tab.id} accessibilityRole="tab" accessibilityState={{ selected: screen === tab.id }} onPress={() => go(tab.id)} style={s.navItem}><Ionicons name={tab.icon} size={23} color={screen === tab.id ? '#BAF473' : '#818996'} /><Text style={[s.navText, screen === tab.id && { color: '#BAF473' }]}>{tab.title}</Text></Pressable>)}</View>
  </SafeAreaView>;
}
export default function App() { return <SafeAreaProvider><StudioApp /></SafeAreaProvider>; }
const s = StyleSheet.create({
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
  safe: { flex: 1, backgroundColor: '#0C100E' }, flex: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', padding: 19, gap: 11, borderBottomWidth: 1, borderColor: '#222A24' }, mark: { width: 43, height: 43, borderRadius: 15, backgroundColor: '#BAF473', alignItems: 'center', justifyContent: 'center' }, brand: { color: '#F5F6F3', fontSize: 23, fontWeight: '800', letterSpacing: -0.7 }, small: { color: '#818C84', fontSize: 9, letterSpacing: 1.8, marginTop: 3 }, badge: { marginLeft: 'auto', backgroundColor: '#273020', paddingHorizontal: 9, paddingVertical: 8, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 5 }, badgeText: { color: '#D2E5BD', fontSize: 9, fontWeight: '800', letterSpacing: 0.6 }, dot: { width: 5, height: 5, backgroundColor: '#BAF473', borderRadius: 3 }, page: { padding: 21, gap: 17, paddingBottom: 30, maxWidth: 520, width: '100%', alignSelf: 'center' }, kicker: { color: '#BAF473', fontSize: 10, fontWeight: '800', letterSpacing: 2, marginTop: 10 }, hero: { color: '#F4F5EE', fontSize: 36, lineHeight: 40, fontWeight: '800', letterSpacing: -1.4 }, description: { color: '#9DA79F', fontSize: 14, lineHeight: 22 }, card: { backgroundColor: '#161D18', borderWidth: 1, borderColor: '#2A342C', borderRadius: 23, padding: 19, gap: 14 }, limeCard: { backgroundColor: '#BAF473', borderColor: '#BAF473', marginVertical: 6 }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, darkLabel: { color: '#24351B', fontSize: 10, letterSpacing: 1.7, fontWeight: '800' }, quotaRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 }, quota: { fontSize: 48, fontWeight: '800', color: '#16200E', letterSpacing: -2 }, darkSub: { color: '#3C512A', fontSize: 11 }, track: { height: 5, backgroundColor: '#A2D264', borderRadius: 4, overflow: 'hidden' }, progress: { height: 5, backgroundColor: '#263D19', borderRadius: 4 }, section: { fontSize: 19, color: '#F4F5EE', fontWeight: '700', letterSpacing: -0.5 }, accent: { fontSize: 12, color: '#BAF473', fontWeight: '700' }, network: { borderWidth: 1, borderColor: '#29322C', borderRadius: 20, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: '#151B17' }, icon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, networkName: { color: '#F4F5EE', fontSize: 16, fontWeight: '700' }, muted: { color: '#89958C', fontSize: 11, lineHeight: 17, marginTop: 3 }, connectButton: { alignSelf: 'flex-start', marginTop: 8, borderRadius: 10, borderWidth: 1, borderColor: '#56634F', paddingHorizontal: 10, paddingVertical: 7 }, connectText: { color: '#BAF473', fontSize: 11, fontWeight: '800' }, button: { backgroundColor: '#BAF473', borderRadius: 17, minHeight: 53, paddingHorizontal: 17, justifyContent: 'center', alignItems: 'center' }, secondary: { backgroundColor: '#29342A', borderWidth: 1, borderColor: '#40513B' }, buttonText: { color: '#16200E', fontWeight: '800', fontSize: 14 }, footnote: { color: '#8B978E', fontSize: 11, lineHeight: 17, textAlign: 'center' }, camera: { aspectRatio: 3 / 4, backgroundColor: '#161E19', borderRadius: 26, overflow: 'hidden', borderWidth: 1, borderColor: '#354335' }, cameraPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 22, gap: 19 }, cameraOrb: { width: 85, height: 85, backgroundColor: '#263821', borderRadius: 43, justifyContent: 'center', alignItems: 'center' }, cameraBadge: { position: 'absolute', top: 17, left: 17, backgroundColor: '#142016D9', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 20 }, cameraControls: { position: 'absolute', bottom: 18, left: 0, right: 0, justifyContent: 'center', flexDirection: 'row', gap: 16 }, round: { backgroundColor: '#102016CC', padding: 13, borderRadius: 30 }, filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }, filterChip: { backgroundColor: '#1A211C', borderWidth: 1, borderColor: '#354039', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 }, filterChipOn: { backgroundColor: '#BAF473', borderColor: '#BAF473' }, filterText: { color: '#A8B0AA', fontSize: 11, fontWeight: '700' }, filterTextOn: { color: '#16200E' }, livePanel: { backgroundColor: '#141B16', borderWidth: 1, borderColor: '#2A352D', borderRadius: 21, padding: 16, gap: 14 }, viewerBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#253022', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 18 }, viewerText: { color: '#D4E8C2', fontSize: 11, fontWeight: '800' }, comment: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#0F1511', padding: 12, borderRadius: 14 }, avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#263322', justifyContent: 'center', alignItems: 'center' }, commentText: { flex: 1, color: '#929D95', fontSize: 11, lineHeight: 17 }, pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, pill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#1D2820', borderRadius: 20, padding: 9 }, pillText: { color: '#C6CEC8', fontSize: 10 }, nav: { borderTopWidth: 1, borderColor: '#28312A', flexDirection: 'row', backgroundColor: '#101712', paddingVertical: 12 }, navItem: { flex: 1, alignItems: 'center', gap: 5 }, navText: { color: '#818996', fontSize: 10, fontWeight: '700' }, warning: { color: '#FFC281', fontSize: 12 },
});
