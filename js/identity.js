// Chatshit Identity System
// Anonymous by default, optional nickname, persistent on this browser.

const IDENTITY_KEY = "chatshit_identity";

function generateUsername() {
  const adjectives = [
    "silent", "lost", "tiny", "hidden", "sleepy",
    "random", "soft", "chaotic", "midnight", "lonely"
  ];

  const nouns = [
    "ghost", "human", "pixel", "user", "soul",
    "void", "dream", "person", "cloud", "cat"
  ];

  const adjective =
    adjectives[Math.floor(Math.random() * adjectives.length)];

  const noun =
    nouns[Math.floor(Math.random() * nouns.length)];

  const number = Math.floor(1000 + Math.random() * 9000);

  return `${adjective}_${noun}_${number}`;
}

function createIdentity(nickname = "") {
  const identity = {
    id: crypto.randomUUID(),
    username: nickname.trim() || generateUsername(),
    nickname: nickname.trim(),
    createdAt: new Date().toISOString()
  };

  localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));

  return identity;
}

function getIdentity() {
  const saved = localStorage.getItem(IDENTITY_KEY);

  if (!saved) {
    return null;
  }

  try {
    return JSON.parse(saved);
  } catch {
    localStorage.removeItem(IDENTITY_KEY);
    return null;
  }
}

function updateNickname(nickname) {
  const identity = getIdentity();

  if (!identity) {
    return null;
  }

  const cleanName = nickname.trim();

  identity.nickname = cleanName;

  if (cleanName) {
    identity.username = cleanName;
  }

  localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));

  return identity;
}

function resetIdentity() {
  localStorage.removeItem(IDENTITY_KEY);
}

window.ChatshitIdentity = {
  create: createIdentity,
  get: getIdentity,
  updateNickname,
  reset: resetIdentity
};