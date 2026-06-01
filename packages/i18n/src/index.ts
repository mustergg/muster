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
  // R25 — Client node live status
  clientNode: {
    status: "Status", running: "Running (PID {{pid}})", stopped: "Stopped",
    uptime: "Uptime", port: "Port", mode: "Mode",
    startNode: "Start Node", stopNode: "Stop Node",
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
  // R25 — Estado ao vivo do nó cliente
  clientNode: {
    status: "Estado", running: "A correr (PID {{pid}})", stopped: "Parado",
    uptime: "Tempo ativo", port: "Porta", mode: "Modo",
    startNode: "Iniciar Nó", stopNode: "Parar Nó",
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