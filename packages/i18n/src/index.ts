import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export type SupportedLocale = 'en' | 'pt';

export const SUPPORTED_LOCALES: Record<SupportedLocale, string> = {
  en: 'English',
  pt: 'Português',
};

export const DEFAULT_LOCALE: SupportedLocale = 'en';

/** localStorage key for the user's chosen locale. */
export const LOCALE_STORAGE_KEY = 'muster-locale';

/** Read the persisted locale (browser only). Falls back to DEFAULT_LOCALE. */
export function getStoredLocale(): SupportedLocale {
  try {
    const ls = (globalThis as { localStorage?: { getItem(k: string): string | null } }).localStorage;
    const raw = ls ? ls.getItem(LOCALE_STORAGE_KEY) : null;
    if (raw && raw in SUPPORTED_LOCALES) return raw as SupportedLocale;
  } catch { /* private mode / no storage */ }
  return DEFAULT_LOCALE;
}

// Inline the translations directly — avoids any import/require issues
// in both browser and Node.js environments
const enTranslation = {
  app: { name: "Muster", tagline: "Your community, your rules." },
  auth: {
    login: "Log in", logout: "Log out", signup: "Create account",
    username: "Username", password: "Password", confirmPassword: "Confirm password",
    usernamePlaceholder: "Choose a username",
    passwordPlaceholder: "Choose a strong password",
    confirmPasswordPlaceholder: "Re-enter your password",
    loggingIn: "Logging in…", creatingAccount: "Creating account…",
    errors: {
      usernameTaken: "That username is already taken.",
      usernameInvalid: "Usernames can only contain letters, numbers, underscores, and hyphens.",
      usernameTooShort: "Username must be at least 3 characters.",
      usernameTooLong: "Username must be 32 characters or fewer.",
      passwordTooShort: "Password must be at least 8 characters.",
      passwordMismatch: "Passwords do not match.",
      wrongPassword: "Wrong password. Check your input and try again.",
      accountNotFound: "No account found with that username on this device.",
      keystoreCorrupted: "Keystore file appears corrupted. Please restore from backup.",
      networkError: "Could not reach the network. Check your connection.",
    },
    exportKeystore: "Export keystore backup",
    importKeystore: "Import keystore backup",
    keystoreWarning: "Your keystore backup contains your encrypted identity. Keep it safe — without it you cannot recover your account if you lose access to this device.",
  },
  nav: {
    communities: "Communities", directMessages: "Direct messages",
    squadChats: "Squad chats", settings: "Settings",
    addCommunity: "Add community", exploreCommunities: "Explore communities",
  },
  community: {
    channels: "Channels", members: "Members", noChannels: "No channels yet.",
    createChannel: "Create channel", createCategory: "Create category",
    inviteMembers: "Invite members", communitySettings: "Community settings",
    leaveConfirm: "Are you sure you want to leave {{name}}?",
    deleteConfirm: "Permanently delete {{name}}? This cannot be undone.",
    roles: { owner: "Owner", admin: "Admin", moderator: "Moderator", member: "Member" },
  },
  channel: {
    textPlaceholder: "Message #{{name}}", emptyHistory: "This is the beginning of #{{name}}.",
    loadingHistory: "Loading message history…", failedHistory: "Could not load message history.",
    edited: "(edited)", deleted: "This message was deleted.",
    reply: "Reply", edit: "Edit", delete: "Delete", copyText: "Copy text",
    pinMessage: "Pin message", confirmDelete: "Delete this message?",
    voice: {
      join: "Join voice", leave: "Leave voice", mute: "Mute", unmute: "Unmute",
      deafen: "Deafen", undeafen: "Undeafen", shareScreen: "Share screen",
      stopSharing: "Stop sharing", connecting: "Connecting…", connected: "Connected",
      disconnected: "Disconnected", speakingIndicator: "{{name}} is speaking",
    },
    temp: {
      label: "Temporary channel", closingIn: "Closes when empty",
      saveChat: "Save chat before closing",
      chatWillBeDeleted: "This channel's chat history will be permanently deleted when it closes.",
    },
  },
  messages: {
    today: "Today", yesterday: "Yesterday", justNow: "Just now",
    minutesAgo: "{{count}} minute ago", minutesAgo_plural: "{{count}} minutes ago",
  },
  status: { online: "Online", idle: "Idle", doNotDisturb: "Do not disturb", offline: "Offline" },
  network: {
    connected: "Connected", connecting: "Connecting to network…", disconnected: "Disconnected",
    peers: "{{count}} peer", peers_plural: "{{count}} peers",
    nodeType: { temporary: "Temporary node", relay: "Relay node", bootstrap: "Bootstrap node" },
    latency: "Latency: {{ms}}ms", reconnecting: "Reconnecting…",
  },
  settings: {
    title: "Settings", account: "Account", appearance: "Appearance",
    notifications: "Notifications", privacy: "Privacy & Security", network: "Network",
    language: "Language", voiceVideo: "Voice & Video", keybinds: "Keybinds", about: "About Muster",
    general: "General", nodes: "Nodes", storage: "Storage", clientNode: "Client Node",
    languageNote: "English is the source language; other languages are translations and may lag behind.",
  },
  // R25 — Phase 9: bandwidth monitor
  bandwidth: {
    title: "Bandwidth", congested: "CONGESTED", cap: "cap {{value}}",
    measuring: "Measuring upload capacity…", measured: "Measured upload {{value}}",
    rtt: "RTT {{ms}}ms",
  },
  // R25 — Phase 7: peer reputation
  reputation: {
    title: "Peer Reputation", refresh: "Refresh",
    preferred: "{{count}} preferred", low: "{{count}} low", blacklisted: "{{count}} blacklisted",
    pos: "POS: {{passed}} passed / {{failed}} failed / {{timeout}} timeout",
    noPeers: "No peers scored yet.", noData: "No data yet — click Refresh.",
  },
  // R25 — Phase 2: signed manifest governance
  governance: {
    title: "Governance", manifest: "Manifest", owner: "Owner", communityId: "Community ID",
    channels: "Channels", admins: "Admins ({{count}})", noAdmins: "No admins yet — owner has full authority.",
    addAdmin: "Add admin", selectMember: "Select a member…", add: "Add", remove: "Remove",
    noManifest: "This community has no signed manifest yet. The manifest is an owner-signed record of admins and channels that the network verifies — admin actions are authorised against it.",
    enable: "Enable signed governance", publishing: "Publishing…",
    ownerOnly: "Only the community owner can enable governance.",
    ownerOnlyRoster: "Only the owner can change the admin roster.",
    noEligible: "No eligible members to promote.", perms: "{{count}} perms",
  },
  // R25 — Phase 4: blob attachments + voice notes
  attachment: {
    loadingImage: "Loading image…", failedImage: "Failed to load image",
    loadingVoice: "Loading voice note…", failedVoice: "Failed to load voice note",
    failed: "failed", dropToUpload: "Drop file to upload",
    attachFile: "Attach file", recordVoice: "Record voice note", stopVoice: "Stop & send voice note",
    tooLarge: "File too large. Maximum size is {{size}}.",
    micDenied: "Microphone access denied or unavailable.",
    notConnected: "Not connected to relay.", uploadFailed: "Failed to upload file.",
  },
  // R25 — Client node live status + config
  clientNode: {
    title: "Client Node", running: "RUNNING",
    status: "Status", runningPid: "Running (PID {{pid}})", stopped: "Stopped",
    uptime: "Uptime", port: "Port", mode: "Mode",
    startNode: "Start Node", stopNode: "Stop Node",
    nodeMode: "Node Mode",
    modes: {
      off: "Off", offDesc: "No local relay. You connect to remote nodes only.",
      temp: "Temp Node", tempDesc: "Contribute 10% passively while active. 30-day data retention. Helps the network without hosting communities.",
      client: "Client Node", clientDesc: "Host your communities permanently on this PC. Acts as a mini server for your squads and community groups.",
    },
    warnClient: "Disabling Client Node keeps your communities active on the network, but content only persists 30 days without a host.",
    warnTemp: "Temp Node contributes passively while you use the app. No permanent hosting.",
    hostedCommunities: "Hosted Communities",
    hostedDesc: "Select which communities to permanently host on this node. Hosted communities retain data even when you're offline.",
    hosted: "HOSTED", noCommunities: "No communities joined yet.",
    resourceLimits: "Resource Limits", maxDisk: "Max disk", maxBandwidth: "Max bandwidth",
    autoStart: "Auto-start on app launch",
    advanced: "Advanced", relayPath: "Relay path",
    relayPathPlaceholder: "apps/relay/dist/index.js (auto)",
    relayPathNote: "Leave empty for auto-detection. Set manually if the relay is at a custom path.",
    logs: "Logs", clear: "Clear", noLogs: "No logs yet. Start the node to see output.",
  },
  // R20: node settings
  nodes: {
    title: "Node Settings", status: "Status",
    connected: "Connected", connecting: "Connecting…", authenticating: "Authenticating…", disconnected: "Disconnected",
    node: "Node", tryingAlternatives: "Trying alternative nodes…", reconnect: "Reconnect",
    known: "Known Nodes ({{count}})", addNode: "Add Node", cancel: "Cancel", add: "Add",
    urlPlaceholder: "ws://hostname:port", namePlaceholder: "Name (optional)",
    empty: "No nodes configured. Add one above or check your seed-nodes.json.",
    uptime: "Uptime: {{percent}}%", daysActive: "{{count}}d active", last: "Last: {{when}}",
    okFail: "{{ok}} ok / {{fail}} fail", removeNode: "Remove node",
    never: "never", justNow: "just now", minutesAgo: "{{count}}m ago", hoursAgo: "{{count}}h ago", daysAgo: "{{count}}d ago",
  },
  // R21: storage settings
  storage: {
    title: "Storage & Data", connectedNode: "Connected Node", usage: "Storage Usage",
    messages: "Messages", dms: "DMs", hosted: "Hosted", cached: "Cached", communities: "communities", retention: "Retention",
    dataRetention: "Data Retention",
    keepAll: "Keep everything", keepAllDesc: "All messages, files, and history are kept permanently on this device.",
    autoClean: "Auto-clean", autoCleanDesc: "Automatically remove cached data older than the set period.",
    viewedOnly: "Keep only viewed", viewedOnlyDesc: "Only retain data from communities and channels you've opened. Unviewed content is cleaned automatically.",
    cleanOlder: "Clean data older than:", days: "days",
    overrides: "Community Overrides", override: "Override", cancel: "Cancel",
    overridesDesc: "Set different retention rules for specific communities, squads, or DMs.",
    selectCommunity: "Select community...", keepForever: "Keep Forever", autoPurge7d: "Auto-purge 7d", deleteNow: "Delete Now",
    keepForeverTag: "Keep forever", purgeAfter: "Purge after {{days}}d", deleted: "Deleted",
    cacheManagement: "Cache Management", clearAll: "Clear All Cache",
    clearConfirm: "Clear all cached data? This cannot be undone. Hosted community data is preserved.",
    clearDesc: "Removes cached data from non-hosted communities. Messages from hosted communities and DMs are preserved.",
    tierMain: "Main Node", tierMainDesc: "Dedicated server — hosts communities permanently",
    tierClient: "Client Node", tierClientDesc: "Contributing user — hosts selected communities + squads",
    tierTemp: "Temp Node", tierTempDesc: "Regular user — 30-day retention, 10% passive network contribution",
  },
  // R24: NAT / connectivity
  nat: {
    title: "Network & NAT", natType: "NAT Type",
    open: "Open", openDesc: "Direct connections work. Other users can connect to your node directly.",
    fullCone: "Full Cone NAT", fullConeDesc: "STUN works. Hole punching possible for most connections. Voice/P2P should work.",
    symmetric: "Symmetric NAT", symmetricDesc: "STUN partially works. Voice needs TURN server. Node connections go through relay proxy.",
    restricted: "Restricted", restrictedDesc: "Behind strict firewall. All connections go through relay proxy. Add a TURN server for voice.",
    unknown: "Unknown", unknownDesc: "NAT type not yet detected. Click \"Detect\" to check.",
    publicIp: "Public IP:", localIp: "Local IP:",
    detecting: "Detecting…", detect: "Detect NAT Type",
    portReachability: "Port Reachability", port: "Port {{port}}:",
    reachable: "Reachable", notReachable: "Not reachable", notChecked: "Not checked", check: "Check",
    portHelp: "To make your node directly accessible, forward port {{port}} on your router to this PC. Without port forwarding, your node still works via relay proxy.",
    relayProxy: "Relay Proxy", proxyActive: "Active (traffic via proxy)", proxyDirect: "Direct (no proxy needed)", proxy: "Proxy:",
    proxyDescActive: "Your connections are routed through a Main Node. Data is E2E encrypted — the proxy cannot read your messages.",
    proxyDescDirect: "You have direct connectivity. No proxy needed.",
    turnServers: "TURN Servers", addTurn: "Add TURN",
    turnDesc: "TURN servers relay voice/video when direct P2P fails (symmetric NAT). Without TURN, voice may not work for some users.",
    turnUrlPlaceholder: "turn:hostname:3478", turnUserPlaceholder: "Username (optional)", turnCredPlaceholder: "Credential (optional)",
    builtIn: "Built-in", noTurn: "No TURN servers configured. Voice will use STUN only (works for most NAT types). Add a TURN server if voice fails for some users.",
    guide: "Connectivity Guide",
  },
  errors: { generic: "Something went wrong. Please try again.", offline: "You are offline.", notFound: "Not found.", forbidden: "You do not have permission to do that." },
  common: {
    save: "Save", cancel: "Cancel", confirm: "Confirm", delete: "Delete", edit: "Edit",
    close: "Close", back: "Back", next: "Next", loading: "Loading…", search: "Search",
    copy: "Copy", copied: "Copied!", optional: "Optional", or: "or", and: "and",
  },
};

const ptTranslation = {
  app: { name: "Muster", tagline: "A tua comunidade, as tuas regras." },
  auth: {
    login: "Entrar", logout: "Sair", signup: "Criar conta",
    username: "Nome de utilizador", password: "Palavra-passe", confirmPassword: "Confirmar palavra-passe",
    usernamePlaceholder: "Escolhe um nome de utilizador",
    passwordPlaceholder: "Escolhe uma palavra-passe forte",
    confirmPasswordPlaceholder: "Repete a palavra-passe",
    loggingIn: "A entrar…", creatingAccount: "A criar conta…",
    errors: {
      usernameTaken: "Esse nome de utilizador já está em uso.",
      usernameInvalid: "O nome de utilizador só pode conter letras, números, underscores e hífens.",
      usernameTooShort: "O nome de utilizador deve ter pelo menos 3 caracteres.",
      usernameTooLong: "O nome de utilizador não pode ter mais de 32 caracteres.",
      passwordTooShort: "A palavra-passe deve ter pelo menos 8 caracteres.",
      passwordMismatch: "As palavras-passe não coincidem.",
      wrongPassword: "Palavra-passe incorreta. Verifica e tenta novamente.",
      accountNotFound: "Nenhuma conta encontrada com esse nome neste dispositivo.",
      keystoreCorrupted: "O ficheiro de keystore parece corrompido. Por favor restaura a partir da cópia de segurança.",
      networkError: "Não foi possível aceder à rede. Verifica a tua ligação.",
    },
    exportKeystore: "Exportar cópia de segurança",
    importKeystore: "Importar cópia de segurança",
    keystoreWarning: "A tua cópia de segurança contém a tua identidade encriptada. Guarda-a em local seguro.",
  },
  nav: {
    communities: "Comunidades", directMessages: "Mensagens diretas",
    squadChats: "Squad chats", settings: "Definições",
    addCommunity: "Adicionar comunidade", exploreCommunities: "Explorar comunidades",
  },
  community: {
    channels: "Canais", members: "Membros", noChannels: "Ainda não há canais.",
    createChannel: "Criar canal", createCategory: "Criar categoria",
    inviteMembers: "Convidar membros", communitySettings: "Definições da comunidade",
    leaveConfirm: "Tens a certeza que queres sair de {{name}}?",
    deleteConfirm: "Eliminar permanentemente {{name}}? Esta ação não pode ser revertida.",
    roles: { owner: "Dono", admin: "Administrador", moderator: "Moderador", member: "Membro" },
  },
  channel: {
    textPlaceholder: "Mensagem em #{{name}}", emptyHistory: "Este é o início de #{{name}}.",
    loadingHistory: "A carregar histórico…", failedHistory: "Não foi possível carregar o histórico.",
    edited: "(editado)", deleted: "Esta mensagem foi eliminada.",
    reply: "Responder", edit: "Editar", delete: "Eliminar", copyText: "Copiar texto",
    pinMessage: "Fixar mensagem", confirmDelete: "Eliminar esta mensagem?",
    voice: {
      join: "Entrar em voz", leave: "Sair do canal de voz", mute: "Silenciar", unmute: "Ativar microfone",
      deafen: "Desativar áudio", undeafen: "Ativar áudio", shareScreen: "Partilhar ecrã",
      stopSharing: "Parar partilha", connecting: "A ligar…", connected: "Ligado",
      disconnected: "Desligado", speakingIndicator: "{{name}} está a falar",
    },
    temp: {
      label: "Canal temporário", closingIn: "Fecha quando ficar vazio",
      saveChat: "Guardar chat antes de fechar",
      chatWillBeDeleted: "O histórico deste canal será eliminado permanentemente quando fechar.",
    },
  },
  messages: {
    today: "Hoje", yesterday: "Ontem", justNow: "Agora mesmo",
    minutesAgo: "Há {{count}} minuto", minutesAgo_plural: "Há {{count}} minutos",
  },
  status: { online: "Online", idle: "Ausente", doNotDisturb: "Não incomodar", offline: "Offline" },
  network: {
    connected: "Ligado", connecting: "A ligar à rede…", disconnected: "Desligado",
    peers: "{{count}} peer", peers_plural: "{{count}} peers",
    nodeType: { temporary: "Nó temporário", relay: "Nó de relay", bootstrap: "Nó bootstrap" },
    latency: "Latência: {{ms}}ms", reconnecting: "A reconectar…",
  },
  settings: {
    title: "Definições", account: "Conta", appearance: "Aparência",
    notifications: "Notificações", privacy: "Privacidade e Segurança", network: "Rede",
    language: "Idioma", voiceVideo: "Voz e Vídeo", keybinds: "Atalhos de teclado", about: "Sobre o Muster",
    general: "Geral", nodes: "Nós", storage: "Armazenamento", clientNode: "Nó Cliente",
    languageNote: "O inglês é o idioma de origem; os outros idiomas são traduções e podem estar desatualizados.",
  },
  // R25 — Phase 9: monitor de largura de banda
  bandwidth: {
    title: "Largura de banda", congested: "CONGESTIONADO", cap: "limite {{value}}",
    measuring: "A medir capacidade de envio…", measured: "Envio medido {{value}}",
    rtt: "RTT {{ms}}ms",
  },
  // R25 — Phase 7: reputação de pares
  reputation: {
    title: "Reputação de Pares", refresh: "Atualizar",
    preferred: "{{count}} preferidos", low: "{{count}} baixos", blacklisted: "{{count}} bloqueados",
    pos: "POS: {{passed}} ok / {{failed}} falhas / {{timeout}} timeout",
    noPeers: "Ainda não há pares pontuados.", noData: "Sem dados — clica em Atualizar.",
  },
  // R25 — Phase 2: governança por manifesto assinado
  governance: {
    title: "Governança", manifest: "Manifesto", owner: "Dono", communityId: "ID da comunidade",
    channels: "Canais", admins: "Administradores ({{count}})", noAdmins: "Ainda sem administradores — o dono tem autoridade total.",
    addAdmin: "Adicionar administrador", selectMember: "Seleciona um membro…", add: "Adicionar", remove: "Remover",
    noManifest: "Esta comunidade ainda não tem manifesto assinado. O manifesto é um registo, assinado pelo dono, de administradores e canais que a rede verifica — as ações de admin são autorizadas contra ele.",
    enable: "Ativar governança assinada", publishing: "A publicar…",
    ownerOnly: "Apenas o dono da comunidade pode ativar a governança.",
    ownerOnlyRoster: "Apenas o dono pode alterar a lista de administradores.",
    noEligible: "Sem membros elegíveis para promover.", perms: "{{count}} permissões",
  },
  // R25 — Phase 4: anexos blob + notas de voz
  attachment: {
    loadingImage: "A carregar imagem…", failedImage: "Falha ao carregar imagem",
    loadingVoice: "A carregar nota de voz…", failedVoice: "Falha ao carregar nota de voz",
    failed: "falhou", dropToUpload: "Larga o ficheiro para enviar",
    attachFile: "Anexar ficheiro", recordVoice: "Gravar nota de voz", stopVoice: "Parar e enviar nota de voz",
    tooLarge: "Ficheiro demasiado grande. O tamanho máximo é {{size}}.",
    micDenied: "Acesso ao microfone negado ou indisponível.",
    notConnected: "Sem ligação ao relay.", uploadFailed: "Falha ao enviar o ficheiro.",
  },
  // R25 — Estado ao vivo do nó cliente + configuração
  clientNode: {
    title: "Nó Cliente", running: "A CORRER",
    status: "Estado", runningPid: "A correr (PID {{pid}})", stopped: "Parado",
    uptime: "Tempo ativo", port: "Porta", mode: "Modo",
    startNode: "Iniciar Nó", stopNode: "Parar Nó",
    nodeMode: "Modo do Nó",
    modes: {
      off: "Desligado", offDesc: "Sem relay local. Ligas-te apenas a nós remotos.",
      temp: "Nó Temporário", tempDesc: "Contribui 10% passivamente enquanto ativo. Retenção de 30 dias. Ajuda a rede sem alojar comunidades.",
      client: "Nó Cliente", clientDesc: "Aloja as tuas comunidades permanentemente neste PC. Funciona como mini-servidor para os teus squads e grupos.",
    },
    warnClient: "Desativar o Nó Cliente mantém as comunidades ativas na rede, mas o conteúdo só persiste 30 dias sem um anfitrião.",
    warnTemp: "O Nó Temporário contribui passivamente enquanto usas a app. Sem alojamento permanente.",
    hostedCommunities: "Comunidades Alojadas",
    hostedDesc: "Escolhe que comunidades alojar permanentemente neste nó. As comunidades alojadas mantêm os dados mesmo quando estás offline.",
    hosted: "ALOJADA", noCommunities: "Ainda não entraste em nenhuma comunidade.",
    resourceLimits: "Limites de Recursos", maxDisk: "Disco máx.", maxBandwidth: "Largura de banda máx.",
    autoStart: "Iniciar automaticamente com a app",
    advanced: "Avançado", relayPath: "Caminho do relay",
    relayPathPlaceholder: "apps/relay/dist/index.js (auto)",
    relayPathNote: "Deixa vazio para deteção automática. Define manualmente se o relay estiver num caminho personalizado.",
    logs: "Registos", clear: "Limpar", noLogs: "Ainda sem registos. Inicia o nó para ver o output.",
  },
  // R20: definições de nós
  nodes: {
    title: "Definições de Nós", status: "Estado",
    connected: "Ligado", connecting: "A ligar…", authenticating: "A autenticar…", disconnected: "Desligado",
    node: "Nó", tryingAlternatives: "A tentar nós alternativos…", reconnect: "Reconectar",
    known: "Nós Conhecidos ({{count}})", addNode: "Adicionar Nó", cancel: "Cancelar", add: "Adicionar",
    urlPlaceholder: "ws://hostname:porta", namePlaceholder: "Nome (opcional)",
    empty: "Sem nós configurados. Adiciona um acima ou verifica o teu seed-nodes.json.",
    uptime: "Disponibilidade: {{percent}}%", daysActive: "{{count}}d ativo", last: "Último: {{when}}",
    okFail: "{{ok}} ok / {{fail}} falhas", removeNode: "Remover nó",
    never: "nunca", justNow: "agora mesmo", minutesAgo: "há {{count}}m", hoursAgo: "há {{count}}h", daysAgo: "há {{count}}d",
  },
  // R21: definições de armazenamento
  storage: {
    title: "Armazenamento e Dados", connectedNode: "Nó Ligado", usage: "Utilização de Armazenamento",
    messages: "Mensagens", dms: "MDs", hosted: "Alojadas", cached: "Em cache", communities: "comunidades", retention: "Retenção",
    dataRetention: "Retenção de Dados",
    keepAll: "Manter tudo", keepAllDesc: "Todas as mensagens, ficheiros e histórico são mantidos permanentemente neste dispositivo.",
    autoClean: "Limpeza automática", autoCleanDesc: "Remove automaticamente os dados em cache mais antigos que o período definido.",
    viewedOnly: "Manter só o visto", viewedOnlyDesc: "Retém apenas dados de comunidades e canais que abriste. O conteúdo não visto é limpo automaticamente.",
    cleanOlder: "Limpar dados mais antigos que:", days: "dias",
    overrides: "Exceções por Comunidade", override: "Exceção", cancel: "Cancelar",
    overridesDesc: "Define regras de retenção diferentes para comunidades, squads ou MDs específicos.",
    selectCommunity: "Seleciona uma comunidade...", keepForever: "Manter Sempre", autoPurge7d: "Limpar 7d", deleteNow: "Eliminar Já",
    keepForeverTag: "Manter sempre", purgeAfter: "Limpar após {{days}}d", deleted: "Eliminado",
    cacheManagement: "Gestão de Cache", clearAll: "Limpar Toda a Cache",
    clearConfirm: "Limpar todos os dados em cache? Esta ação não pode ser revertida. Os dados de comunidades alojadas são preservados.",
    clearDesc: "Remove dados em cache de comunidades não alojadas. As mensagens de comunidades alojadas e MDs são preservadas.",
    tierMain: "Nó Principal", tierMainDesc: "Servidor dedicado — aloja comunidades permanentemente",
    tierClient: "Nó Cliente", tierClientDesc: "Utilizador contribuinte — aloja comunidades + squads selecionados",
    tierTemp: "Nó Temporário", tierTempDesc: "Utilizador normal — retenção de 30 dias, 10% de contribuição passiva",
  },
  // R24: NAT / conectividade
  nat: {
    title: "Rede e NAT", natType: "Tipo de NAT",
    open: "Aberto", openDesc: "Ligações diretas funcionam. Outros utilizadores podem ligar-se diretamente ao teu nó.",
    fullCone: "Full Cone NAT", fullConeDesc: "STUN funciona. Hole punching possível na maioria das ligações. Voz/P2P deve funcionar.",
    symmetric: "NAT Simétrico", symmetricDesc: "STUN funciona parcialmente. A voz precisa de servidor TURN. As ligações entre nós passam pelo relay proxy.",
    restricted: "Restrito", restrictedDesc: "Atrás de firewall estrita. Todas as ligações passam pelo relay proxy. Adiciona um servidor TURN para voz.",
    unknown: "Desconhecido", unknownDesc: "Tipo de NAT ainda não detetado. Clica em \"Detetar\" para verificar.",
    publicIp: "IP público:", localIp: "IP local:",
    detecting: "A detetar…", detect: "Detetar Tipo de NAT",
    portReachability: "Acessibilidade da Porta", port: "Porta {{port}}:",
    reachable: "Acessível", notReachable: "Não acessível", notChecked: "Não verificado", check: "Verificar",
    portHelp: "Para tornar o teu nó diretamente acessível, reencaminha a porta {{port}} no teu router para este PC. Sem reencaminhamento, o teu nó funciona na mesma via relay proxy.",
    relayProxy: "Relay Proxy", proxyActive: "Ativo (tráfego via proxy)", proxyDirect: "Direto (sem proxy)", proxy: "Proxy:",
    proxyDescActive: "As tuas ligações são encaminhadas por um Nó Principal. Os dados são encriptados E2E — o proxy não consegue ler as tuas mensagens.",
    proxyDescDirect: "Tens conectividade direta. Sem proxy necessário.",
    turnServers: "Servidores TURN", addTurn: "Adicionar TURN",
    turnDesc: "Os servidores TURN encaminham voz/vídeo quando o P2P direto falha (NAT simétrico). Sem TURN, a voz pode não funcionar para alguns utilizadores.",
    turnUrlPlaceholder: "turn:hostname:3478", turnUserPlaceholder: "Utilizador (opcional)", turnCredPlaceholder: "Credencial (opcional)",
    builtIn: "Incorporado", noTurn: "Sem servidores TURN configurados. A voz usará apenas STUN (funciona na maioria dos tipos de NAT). Adiciona um servidor TURN se a voz falhar para alguns utilizadores.",
    guide: "Guia de Conectividade",
  },
  errors: { generic: "Algo correu mal. Tenta novamente.", offline: "Estás offline.", notFound: "Não encontrado.", forbidden: "Não tens permissão para fazer isso." },
  common: {
    save: "Guardar", cancel: "Cancelar", confirm: "Confirmar", delete: "Eliminar", edit: "Editar",
    close: "Fechar", back: "Voltar", next: "Seguinte", loading: "A carregar…", search: "Pesquisar",
    copy: "Copiar", copied: "Copiado!", optional: "Opcional", or: "ou", and: "e",
  },
};

export async function initI18n(locale: SupportedLocale = DEFAULT_LOCALE): Promise<void> {
  await i18n
	.use(initReactI18next)
    .init({
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    debug: false,
    interpolation: { escapeValue: false },
    resources: {
      en: { translation: enTranslation },
      pt: { translation: ptTranslation },
    },
  });
}

export async function setLocale(locale: SupportedLocale): Promise<void> {
  await i18n.changeLanguage(locale);
  try {
    const ls = (globalThis as { localStorage?: { setItem(k: string, v: string): void } }).localStorage;
    if (ls) ls.setItem(LOCALE_STORAGE_KEY, locale);
  } catch { /* ignore */ }
}

export { i18n };
export default i18n;