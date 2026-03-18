import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export type SupportedLocale = 'en' | 'pt';

export const SUPPORTED_LOCALES: Record<SupportedLocale, string> = {
  en: 'English',
  pt: 'Português',
};

export const DEFAULT_LOCALE: SupportedLocale = 'en';

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
}

export { i18n };
export default i18n;