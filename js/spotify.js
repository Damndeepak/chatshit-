/* Private Spotify Now Playing bridge. Track data stays in this browser. */
(function () {
  "use strict";

  const TOKEN_KEY = "chatshit_spotify_token_v1";
  const STATE_KEY = "chatshit_spotify_oauth_state";
  const VERIFIER_KEY = "chatshit_spotify_code_verifier";
  const POLL_MS = 30000;
  const SCOPE = "user-read-currently-playing";
  const config = window.CHATSHIT_BACKEND || {};
  const redirectUri = config.spotifyRedirectUri || (window.location.origin + window.location.pathname);
  let tokens = readTokens();
  let currentTrack = null;
  let timer = null;
  let pollInFlight = false;
  let lastError = "";

  function readTokens() {
    try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || "null"); }
    catch (error) { return null; }
  }

  function saveTokens(value) {
    tokens = value;
    try {
      if (value) localStorage.setItem(TOKEN_KEY, JSON.stringify(value));
      else localStorage.removeItem(TOKEN_KEY);
    } catch (error) {
      throw new Error("This browser could not save the Spotify connection. Check storage settings.");
    }
  }

  function dispatch() {
    window.dispatchEvent(new CustomEvent("chatshit:spotify", { detail: getState() }));
  }

  function getState() {
    return { connected: Boolean(tokens && (tokens.refreshToken || tokens.accessToken)), track: currentTrack, error: lastError };
  }

  function randomString(length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    return Array.from(bytes, function (byte) { return alphabet[byte % alphabet.length]; }).join("");
  }

  function base64Url(bytes) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(bytes)))
      .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  }

  async function challengeFor(verifier) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return base64Url(digest);
  }

  async function connect() {
    if (!config.spotifyClientId) throw new Error("Add the Spotify Client ID in js/cloud-config.js first.");
    if (!window.isSecureContext) throw new Error("Spotify sign-in needs HTTPS or localhost.");
    const verifier = randomString(64);
    const state = randomString(32);
    sessionStorage.setItem(VERIFIER_KEY, verifier);
    sessionStorage.setItem(STATE_KEY, state);
    const challenge = await challengeFor(verifier);
    const url = new URL("https://accounts.spotify.com/authorize");
    url.search = new URLSearchParams({
      client_id: config.spotifyClientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: SCOPE,
      state: state,
      code_challenge_method: "S256",
      code_challenge: challenge
    }).toString();
    window.location.assign(url.toString());
  }

  function cleanOAuthQuery() {
    const url = new URL(window.location.href);
    ["code", "state", "error"].forEach(function (key) { url.searchParams.delete(key); });
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  }

  async function exchangeCode(code) {
    const verifier = sessionStorage.getItem(VERIFIER_KEY);
    if (!verifier) throw new Error("Spotify sign-in expired. Connect again.");
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.spotifyClientId,
        grant_type: "authorization_code",
        code: code,
        redirect_uri: redirectUri,
        code_verifier: verifier
      })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error_description || "Spotify could not complete sign-in.");
    saveTokens({ accessToken: body.access_token, refreshToken: body.refresh_token || "", expiresAt: Date.now() + (body.expires_in || 3600) * 1000 });
    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem(STATE_KEY);
  }

  async function refreshAccessToken() {
    if (!tokens || !tokens.refreshToken) throw new Error("Spotify sign-in expired. Connect again.");
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.spotifyClientId,
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken
      })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error_description || "Spotify needs you to connect again.");
    saveTokens({
      accessToken: body.access_token,
      refreshToken: body.refresh_token || tokens.refreshToken,
      expiresAt: Date.now() + (body.expires_in || 3600) * 1000
    });
    return tokens.accessToken;
  }

  async function accessToken() {
    if (tokens && tokens.accessToken && tokens.expiresAt > Date.now() + 60000) return tokens.accessToken;
    return refreshAccessToken();
  }

  async function requestCurrentTrack(token) {
    return fetch("https://api.spotify.com/v1/me/player/currently-playing", {
      headers: { Authorization: "Bearer " + token }
    });
  }

  async function fetchCurrentTrack() {
    let response = await requestCurrentTrack(await accessToken());
    if (response.status === 401) response = await requestCurrentTrack(await refreshAccessToken());
    if (response.status === 204) return null;
    if (response.status === 403) throw new Error("Spotify denied playback access. Check the app and account allowlist.");
    if (response.status === 429) throw new Error("Spotify is busy. Chatshit will try again shortly.");
    if (!response.ok) throw new Error("Spotify could not read playback right now.");
    const payload = await response.json();
    const item = payload && payload.item;
    if (!payload.is_playing || !item || item.type !== "track") return null;
    const spotifyUrl = item.external_urls && item.external_urls.spotify;
    if (!spotifyUrl || !spotifyUrl.startsWith("https://open.spotify.com/")) return null;
    return {
      title: item.name || "Unknown track",
      artist: (item.artists || []).map(function (artist) { return artist.name; }).filter(Boolean).join(", "),
      url: spotifyUrl,
      image: item.album && item.album.images && item.album.images.length ? item.album.images[item.album.images.length - 1].url : ""
    };
  }

  function schedulePoll() {
    window.clearTimeout(timer);
    if (tokens) timer = window.setTimeout(poll, POLL_MS);
  }

  async function poll() {
    if (!tokens || pollInFlight || document.visibilityState === "hidden") {
      schedulePoll();
      return;
    }
    pollInFlight = true;
    try {
      const next = await fetchCurrentTrack();
      const changed = JSON.stringify(currentTrack) !== JSON.stringify(next);
      currentTrack = next;
      lastError = "";
      if (changed) dispatch();
    } catch (error) {
      lastError = error.message || "Spotify playback could not be refreshed.";
      if (/connect again|sign-in expired/i.test(lastError)) saveTokens(null);
      dispatch();
    } finally {
      pollInFlight = false;
      schedulePoll();
    }
  }

  async function init() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const returnedState = params.get("state");
    const authError = params.get("error");
    if (code || authError) {
      const savedState = sessionStorage.getItem(STATE_KEY);
      cleanOAuthQuery();
      try {
        if (authError) throw new Error("Spotify sign-in was cancelled.");
        if (!savedState || returnedState !== savedState) throw new Error("Spotify sign-in could not be verified. Connect again.");
        await exchangeCode(code);
      } catch (error) {
        lastError = error.message;
        sessionStorage.removeItem(VERIFIER_KEY);
        sessionStorage.removeItem(STATE_KEY);
        dispatch();
        return getState();
      }
    }
    dispatch();
    if (tokens) await poll();
    return getState();
  }

  function disconnect() {
    window.clearTimeout(timer);
    saveTokens(null);
    currentTrack = null;
    lastError = "";
    dispatch();
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && tokens) poll();
  });
  window.addEventListener("pagehide", function () { window.clearTimeout(timer); });

  window.ChatshitSpotify = {
    connect: connect,
    disconnect: disconnect,
    init: init,
    getState: getState,
    getCurrentTrack: function () { return currentTrack; }
  };
})();
