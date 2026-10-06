/* Optional Supabase bridge for the one-room community chat and public Notes. */
(function () {
  "use strict";
  const config = window.CHATSHIT_BACKEND || {};
  const configured = Boolean(config.url && config.publishableKey);
  let client = null;
  let userId = null;

  async function ensureClient() {
    if (!configured) return null;
    if (client) return client;
    if (!window.supabase) {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
        script.onload = resolve;
        script.onerror = () => reject(new Error("Could not load the chat connection library."));
        document.head.appendChild(script);
      });
    }
    if (!window.supabase) throw new Error("The chat connection library did not start.");
    client = window.supabase.createClient(config.url, config.publishableKey);
    return client;
  }

  async function connect(displayName) {
    if (!configured) return { configured: false, connected: false };
    await ensureClient();
    let { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) {
      const result = await client.auth.signInAnonymously({ options: { data: { display_name: displayName || "Someone" } } });
      data = result.data;
      error = result.error;
      if (error) throw error;
    }
    userId = data.session?.user?.id || data.user?.id || null;
    if (!userId) throw new Error("Could not start an anonymous chat session.");
    return { configured: true, connected: true, userId };
  }

  async function loadMessages() {
    const { data, error } = await client.from("global_messages").select("id,user_id,display_name,body,created_at").order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return (data || []).reverse().map(row => ({ id: row.id, userId: row.user_id, displayName: row.display_name, text: row.body, time: new Date(row.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), createdAt: new Date(row.created_at).getTime(), from: row.user_id === userId ? "me" : "them" }));
  }

  async function loadNotes() {
    const { data, error } = await client.from("global_notes").select("user_id,display_name,body,music_url,expires_at,updated_at").gt("expires_at", new Date().toISOString()).order("updated_at", { ascending: false }).limit(50);
    if (error) throw error;
    return (data || []).map(row => ({ userId: row.user_id, name: row.display_name, text: row.body, musicUrl: row.music_url, expiresAt: row.expires_at }));
  }

  async function loadProfiles() {
    let rows = [];
    let offset = 0;
    const pageSize = 500;
    while (true) {
      const { data, error } = await client.from("profiles").select("user_id,display_name,created_at").order("display_name", { ascending: true }).order("user_id", { ascending: true }).range(offset, offset + pageSize - 1);
      if (error) throw error;
      rows = rows.concat(data || []);
      if (!data || data.length < pageSize) break;
      offset += pageSize;
    }
    return rows.map(row => ({ userId: row.user_id, displayName: row.display_name, createdAt: row.created_at }));
  }

  async function saveProfile(displayName) {
    if (!userId) throw new Error("Your community profile is still connecting.");
    const cleanName = String(displayName || "Someone").trim().slice(0, 28) || "Someone";
    const { error } = await client.from("profiles").upsert({ user_id: userId, display_name: cleanName, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw error;
  }

  function subscribe(onMessage, onNote, onProfile) {
    if (!client) return function () {};
    const channel = client.channel("chatshit-community-room")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "global_messages" }, payload => {
        const row = payload.new;
        onMessage({ id: row.id, userId: row.user_id, displayName: row.display_name, text: row.body, time: new Date(row.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), createdAt: new Date(row.created_at).getTime(), from: row.user_id === userId ? "me" : "them" });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "global_notes" }, onNote)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, function () { if (onProfile) onProfile(); })
      .subscribe();
    return function () { client.removeChannel(channel); };
  }

  async function sendMessage(text, displayName) {
    if (!userId) throw new Error("The shared chat is still connecting.");
    const { data, error } = await client.from("global_messages").insert({ user_id: userId, display_name: displayName || "Someone", body: text }).select("id,user_id,display_name,body,created_at").single();
    if (error) throw error;
    const row = data;
    return { id: row.id, userId: row.user_id, displayName: row.display_name, text: row.body, time: new Date(row.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), createdAt: new Date(row.created_at).getTime(), from: "me" };
  }

  async function saveNote(text, musicUrl, displayName) {
    if (!userId) throw new Error("Notes are still connecting.");
    if (!text) {
      const { error } = await client.from("global_notes").delete().eq("user_id", userId);
      if (error) throw error;
      return;
    }
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { error } = await client.from("global_notes").upsert({ user_id: userId, display_name: displayName || "Someone", body: text, music_url: musicUrl || null, expires_at: expiresAt, updated_at: new Date().toISOString() });
    if (error) throw error;
  }

  window.ChatshitCloud = { configured, connect, loadMessages, loadNotes, loadProfiles, saveProfile, subscribe, sendMessage, saveNote, get userId() { return userId; } };
})();
