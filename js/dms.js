/* Chatshit — lightweight, local-first DM interface. */
(function(){
  "use strict";
  const STORAGE_KEY="chatshit_conversations_v1";
  const THEME_KEY="chatshit_theme_v1";
  const NOTE_KEY="chatshit_note_v1";
  const CLOUD_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const colors=["violet","peach","mint","blue","rose","gold","cyan"];
  const seed=[{id:"everyone",name:"Everyone",username:"PUBLIC ROOM",color:"violet",online:true,story:"",unread:0,group:true,pinned:true,messages:[]}];
  const emojis=["♡","✨","😂","🥹","🌿","☕","🫶","🌸","🔥","💌","☁️","🍰"];
  let conversations=loadConversations();
  let activeId="everyone";
  let toastTimer;
  let currentStory=null;
  let storyQueue=[];
  let storyIndex=0;
  let storyExpiryTimer;
  let storyAdvanceTimer;
  let cloudConnected=false;
  let cloudNotes=[];
  let cloudStories=[];
  let cloudProfiles=[];
  let profileDirectoryError="";
  let spotifyNowPlaying=null;
  let spotifyConnected=false;
  let myNote=loadMyNote();
  let installPrompt=null;
  let unsubscribeCloud=null;
  const identity=window.ChatshitIdentity.get()||window.ChatshitIdentity.create();

  const $=function(selector,root){return (root||document).querySelector(selector);};
  const $$=function(selector,root){return Array.from((root||document).querySelectorAll(selector));};
  const node=function(tag,className,text){
    const element=document.createElement(tag);
    if(className)element.className=className;
    if(text!==undefined)element.textContent=text;
    return element;
  };
  function loadConversations(){
    try{
      const saved=localStorage.getItem(STORAGE_KEY);
      if(saved){
        const parsed=JSON.parse(saved);
        const room=Array.isArray(parsed)&&parsed.find(function(item){return item&&item.id==="everyone";});
        if(room&&Array.isArray(room.messages))seed[0].messages=room.messages.filter(function(message){return message&&CLOUD_ID.test(message.id||"")&&CLOUD_ID.test(message.userId||"");}).slice(-100);
      }
    }catch(error){
      try{localStorage.removeItem(STORAGE_KEY);}catch(ignored){}
    }
    return seed.map(function(item){return JSON.parse(JSON.stringify(item));});
  }
  function loadMyNote(){
    try{const saved=JSON.parse(localStorage.getItem(NOTE_KEY)||"null");if(saved&&saved.expiresAt&&Date.parse(saved.expiresAt)<Date.now()){localStorage.removeItem(NOTE_KEY);return null;}return saved&&typeof saved==="object"?saved:null;}catch(error){return null;}
  }
  function saveConversations(){
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(conversations));}
    catch(error){showToast("This browser is full. Your latest message is still on screen.");}
  }
  function saveMyNote(){try{if(myNote)localStorage.setItem(NOTE_KEY,JSON.stringify(myNote));else localStorage.removeItem(NOTE_KEY);}catch(error){}}
  function initials(name){return name.trim().split(/\s+/).slice(0,2).map(function(part){return part.charAt(0);}).join("").toUpperCase()||"?"}
  function findConversation(id){return conversations.find(function(item){return item.id===id;})||conversations[0]}
  function currentConversation(){return findConversation(activeId)}
  function lastMessage(person){return person.messages[person.messages.length-1]||{text:"No messages yet",time:""}}
  function messagePreview(person){
    const message=lastMessage(person);
    return (message.from==="me"?"You: ":"")+((message.kind==="image")?"Sent a photo":message.text||"No messages yet");
  }
  function sortConversations(){
    return conversations.slice().sort(function(a,b){
      if(a.pinned&&!b.pinned)return -1;
      if(b.pinned&&!a.pinned)return 1;
      const aTime=a.messages.length?a.messages[a.messages.length-1].createdAt||0:0;
      const bTime=b.messages.length?b.messages[b.messages.length-1].createdAt||0:0;
      if(aTime&&bTime)return bTime-aTime;
      if(aTime)return -1;
      if(bTime)return 1;
      return conversations.indexOf(a)-conversations.indexOf(b);
    });
  }
  function avatar(person,extraClass){
    const element=node("span","avatar avatar-"+(person.color||"violet")+(extraClass?" "+extraClass:""),initials(person.name));
    element.setAttribute("aria-hidden","true");
    if(person.online)element.appendChild(node("i","online-dot"));
    return element;
  }
  function syncIdentity(){
    const display=identity.nickname||identity.username||"you";
    const first=initials(display).slice(0,1);
    $("#selfName").textContent=display;
    $("#selfHandle").textContent="@"+(identity.username||"here_for_a_bit").replace(/^@/,"");
    $("#selfAvatar").textContent=first;
    $("#mobileSelfAvatar").textContent=first;
    $("#profileEditAvatar").textContent=first;
    $("#profileName").value=identity.nickname||"";
  }
  function renderStories(){
    const strip=$("#storiesStrip");
    strip.replaceChildren();
    window.clearTimeout(storyExpiryTimer);
    const now=Date.now();
    const activeStories=cloudStories.filter(function(story){return Date.parse(story.expiresAt)>now;});
    if(cloudConnected&&activeStories.length){
      const nextExpiry=Math.min.apply(null,activeStories.map(function(story){return Date.parse(story.expiresAt);}));
      storyExpiryTimer=window.setTimeout(reloadCloudStories,Math.max(1000,nextExpiry-now+1000));
    }
    const ownId=cloudConnected?window.ChatshitCloud.userId:"";
    const ownStories=activeStories.filter(function(story){return story.userId===ownId;});
    const own=node("button","story-button story-own");
    own.type="button";
    own.setAttribute("aria-label",ownStories.length?"View your story":"Add to your story");
    const ring=node("span","story-ring");
    ring.appendChild(avatar({name:identity.nickname||identity.username||"You",color:"me"}));
    own.appendChild(ring);
    own.appendChild(node("span","story-label","Your story"));
    own.addEventListener("click",function(){ownStories.length?openStoryGroup(ownStories):openStoryComposer();});
    strip.appendChild(own);
    const groups=new Map();
    activeStories.filter(function(story){return story.userId!==ownId;}).forEach(function(story){
      if(!groups.has(story.userId))groups.set(story.userId,[]);
      groups.get(story.userId).push(story);
    });
    Array.from(groups.values()).slice(0,12).forEach(function(stories,index){
      const story=stories[stories.length-1];
      const button=node("button","story-button");
      button.type="button";
      button.setAttribute("aria-label","View "+story.displayName+"'s story");
      const storyRing=node("span","story-ring");
      storyRing.appendChild(avatar({name:story.displayName,color:colors[index%colors.length]}));
      button.appendChild(storyRing);
      button.appendChild(node("span","story-label",story.displayName.split(" ")[0]));
      button.addEventListener("click",function(){openStoryGroup(stories);});
      strip.appendChild(button);
    });
    if(!cloudConnected)strip.appendChild(node("span","stories-empty-note","Community stories appear here after cloud setup."));
    else if(!activeStories.length)strip.appendChild(node("span","stories-empty-note","No stories yet. Add the first one."));
  }
  function renderNotes(){
    const strip=$("#notesStrip");
    if(!strip)return;
    strip.replaceChildren();
    const selfName=identity.nickname||identity.username||"You";
    const savedSelf=cloudConnected?cloudNotes.find(function(note){return note.userId===window.ChatshitCloud.userId;}):null;
    const own=savedSelf||myNote;
    const entries=[{self:true,name:"You",color:"me",text:own&&own.text||"Drop a little thought…",musicUrl:own&&own.musicUrl||"",nowPlaying:spotifyNowPlaying}];
    const others=cloudConnected?cloudNotes.filter(function(note){return note.userId!==window.ChatshitCloud.userId;}).map(function(note,index){return {name:note.name,color:colors[index%colors.length],text:note.text,musicUrl:note.musicUrl||""};}):[];
    others.slice(0,5).forEach(function(note){entries.push(note);});
    entries.forEach(function(entry){
      const card=node("article","note-person"+(entry.self?" is-self":"")+(entry.self&&entry.nowPlaying?" is-listening":""));
      const bubble=node("button","note-bubble"+(entry.self&&!own?" note-empty":""));
      bubble.type="button";
      bubble.setAttribute("aria-label",entry.self?"Add or edit your note":"View "+entry.name+"'s note");
      bubble.appendChild(node("span","note-copy",entry.text));
      if(entry.self)bubble.addEventListener("click",openNoteEditor);
      else bubble.addEventListener("click",function(){showToast(entry.name+" shared a little note with everyone.");});
      card.appendChild(bubble);
      const safeMusicUrl=validMusicUrl(entry.musicUrl||"");
      if(safeMusicUrl){
        const music=node("a","note-music-link","♫ song");
        music.href=safeMusicUrl;
        music.target="_blank";
        music.rel="noopener noreferrer";
        music.setAttribute("aria-label","Open song link from "+entry.name+"'s note");
        card.appendChild(music);
      }
      if(entry.self&&entry.nowPlaying){
        const live=node("a","note-now-playing");
        live.href=entry.nowPlaying.url;
        live.target="_blank";
        live.rel="noopener noreferrer";
        live.setAttribute("aria-label","Open currently playing track on Spotify: "+entry.nowPlaying.title);
        if(entry.nowPlaying.image){
          const cover=node("img","note-now-playing-art");
          cover.src=entry.nowPlaying.image;
          cover.alt="";
          cover.loading="lazy";
          live.appendChild(cover);
        }
        const liveCopy=node("span","note-now-playing-copy");
        liveCopy.appendChild(node("strong","",entry.nowPlaying.title));
        liveCopy.appendChild(node("small","",entry.nowPlaying.artist||"Now playing"));
        liveCopy.appendChild(node("span","spotify-wordmark","LISTENING ON SPOTIFY"));
        live.appendChild(liveCopy);
        card.appendChild(live);
      }
      const person=node("div","note-person-line");
      const face=node("span","avatar avatar-"+(entry.color||"violet"),entry.self?initials(selfName).slice(0,1):initials(entry.name).slice(0,1));
      person.appendChild(face);
      person.appendChild(node("span","note-person-name",entry.self?"You":entry.name.split(" ")[0]));
      card.appendChild(person);
      strip.appendChild(card);
    });
  }

  function syncSpotifyControls(state,shouldRender){
    state=state||{};
    spotifyConnected=Boolean(state.connected);
    spotifyNowPlaying=state.track||null;
    const status=$("#spotifyConnectionState");
    const hint=$("#spotifyConnectionHint");
    const connect=$("#spotifyConnectButton");
    const disconnect=$("#spotifyDisconnectButton");
    const share=$("#spotifyUseTrackButton");
    if(!status)return;
    status.textContent=state.error?"Needs attention":(spotifyConnected?(spotifyNowPlaying?"Listening now":"Connected"):"Not connected");
    hint.textContent=state.error||((window.CHATSHIT_BACKEND&&window.CHATSHIT_BACKEND.spotifyClientId)?(spotifyConnected?"Live playback is private to this device.":"See your live track here, then choose if you want to share its link."):"Add your Spotify Client ID in js/cloud-config.js to connect.");
    connect.hidden=spotifyConnected;
    disconnect.hidden=!spotifyConnected;
    share.disabled=!spotifyNowPlaying;
    if(shouldRender!==false)renderNotes();
  }

  function openNoteEditor(){
    const note=savedOwnNote();
    $("#noteText").value=note&&note.text||"";
    $("#noteMusicUrl").value=note&&note.musicUrl||"";
    $("#noteVisibilityHint").textContent=cloudConnected?"Your note is public for everyone here for 24 hours.":"Preview mode: this note saves on this device until the shared backend is connected.";
    if(window.ChatshitSpotify)syncSpotifyControls(window.ChatshitSpotify.getState(),false);
    $("#noteDialog").showModal();
    $("#noteText").focus();
  }

  function savedOwnNote(){
    return (cloudConnected&&cloudNotes.find(function(note){return note.userId===window.ChatshitCloud.userId;}))||myNote;
  }

  function validMusicUrl(value){
    if(!value)return "";
    try{
      const url=new URL(value.trim());
      const allowed=["music.youtube.com","youtube.com","www.youtube.com","m.youtube.com","youtu.be","open.spotify.com"];
      return url.protocol==="https:"&&allowed.includes(url.hostname.toLowerCase())?url.href:null;
    }catch(error){return null;}
  }
  function renderConversations(){
    const list=$("#conversationList");
    const people=sortConversations();
    list.replaceChildren();
    if(!people.length){
      list.appendChild(node("div","list-empty","Your community room will show up here."));
    }
    people.forEach(function(person){
      const button=node("button","conversation-item"+(person.id===activeId?" is-active":"")+(person.unread?" is-unread":""));
      button.type="button";
      button.setAttribute("role","listitem");
      button.setAttribute("aria-current",person.id===activeId?"true":"false");
      button.appendChild(avatar(person));
      const copy=node("span","conversation-copy");
      const topline=node("span","conversation-topline");
      topline.appendChild(node("span","conversation-name",person.name));
      topline.appendChild(node("span","conversation-time",person.messages.length?lastMessage(person).time||"now":""));
      copy.appendChild(topline);
      copy.appendChild(node("span","conversation-preview",messagePreview(person)));
      button.appendChild(copy);
      const trailing=node("span","conversation-trailing");
      if(person.unread)trailing.appendChild(node("span","unread-badge",String(person.unread)));
      else if(person.group)trailing.appendChild(node("span","conversation-group","group"));
      button.appendChild(trailing);
      button.addEventListener("click",function(){openConversation(person.id);});
      list.appendChild(button);
    });
    const unread=conversations.reduce(function(total,person){return total+person.unread;},0);
    $("#navUnread").textContent=unread?String(Math.min(unread,9)):"";
    $("#navUnread").hidden=!unread;
  }
  function renderHeader(){
    const person=currentConversation();
    if(!person)return;
    $("#chatPersonName").textContent=person.name;
    $("#chatPersonStatus").replaceChildren();
    if(person.id==="everyone"){
      const orb=node("span","status-orb"+(cloudConnected?"":" is-offline"));
      $("#chatPersonStatus").appendChild(orb);
      $("#chatPersonStatus").appendChild(document.createTextNode(cloudConnected?"Live community room":"Connect the community backend"));
      $("#chatStorageLabel").textContent=cloudConnected?"Live with everyone":"Messages and media are not shared yet";
      $("#chatHandle").textContent="ONE GLOBAL ROOM";
      $("#messageInput").placeholder="Say hello to everyone…";
    }
    const headerAvatar=$("#chatPersonAvatar");
    headerAvatar.className="avatar avatar-"+(person.color||"violet");
    headerAvatar.textContent=initials(person.name);
    if(person.online&&(person.id!=="everyone"||cloudConnected))headerAvatar.appendChild(node("i","online-dot"));
    $("#detailAvatar").className="avatar avatar-large avatar-"+(person.color||"violet");
    $("#detailAvatar").textContent=initials(person.name);
    $("#detailName").textContent=person.name;
    $("#detailHandle").textContent=person.username;
    $("#detailStatus").textContent=cloudConnected?"Live shared room":"Cloud setup needed";
    const safetyTitle=$(".safety-note strong");
    const safetyCopy=$(".safety-note p");
    if(person.id==="everyone"){
      safetyTitle.textContent=cloudConnected?"Public community chat":"Cloud setup needed";
      safetyCopy.textContent=cloudConnected?"Messages, images and stories are visible to community members. Don’t share private information.":"Connect the shared backend before posting messages, images or stories.";
    }
  }
  function renderMessages(){
    const person=currentConversation();
    if(!person)return;
    renderHeader();
    const thread=$("#messageThread");
    thread.replaceChildren();
    if(!person.messages.length){
      const welcome=node("div","empty-chat");
      const content=node("div","");
      const art=node("div","empty-chat-art");
      art.innerHTML='<svg class="icon"><use href="#i-chat"/></svg>';
      content.appendChild(art);
      content.appendChild(node("h2","","It’s quiet in here."));
      content.appendChild(node("p","",cloudConnected?"Say the first hello to everyone in your community.":"Connect the shared backend to start chatting with everyone."));
      welcome.appendChild(content);
      thread.appendChild(welcome);
      renderConversations();
      return;
    }
    thread.appendChild(node("div","date-divider",person.id==="everyone"?"THE WHOLE ROOM, RIGHT HERE":"TODAY"));
    person.messages.forEach(function(message,index){
      const outgoing=message.from==="me";
      const row=node("article","message-row "+(outgoing?"outgoing":"incoming"));
      const messagePerson=person.id==="everyone"?{name:message.displayName||"Someone",color:colors[(message.displayName||"S").charCodeAt(0)%colors.length]}:person;
      if(!outgoing)row.appendChild(avatar(messagePerson));
      const stack=node("div","message-stack");
      if(person.id==="everyone"&&!outgoing)stack.appendChild(node("div","message-author",message.displayName||"Someone"));
      const bubble=node("div","message-bubble"+(message.kind==="image"?" image-bubble":""));
      if(message.kind==="image"&&message.imageUrl){
        const image=node("img");
        image.src=message.imageUrl;
        image.alt="Image shared in this conversation";
        bubble.appendChild(image);
        if(message.text&&message.text!=="Photo")bubble.appendChild(node("div","message-caption",message.text));
      }else if(message.kind==="like"){
        bubble.classList.add("like-bubble");
        bubble.textContent="❤️";
      }else{
        bubble.textContent=message.text;
      }
      stack.appendChild(bubble);
      const meta=node("div","message-meta");
      meta.appendChild(node("span","message-time",message.time||"now"));
      stack.appendChild(meta);
      row.appendChild(stack);
      thread.appendChild(row);
    });
    thread.scrollTop=thread.scrollHeight;
    renderConversations();
  }
  function openConversation(id){
    const person=findConversation(id);
    activeId=person.id;
    person.unread=0;
    $("body").classList.remove("show-people");
    $("body").classList.add("show-chat");
    $(".app-shell").classList.remove("people-mode");
    $("#peopleView").hidden=true;
    $("#inboxPanel").hidden=false;
    $("#chatPanel").hidden=false;
    $$(".nav-button").forEach(function(button){button.classList.toggle("is-active",button.dataset.view===(person.id==="everyone"?"everyone":"inbox"));});
    renderMessages();
  }
  function showInbox(){
    $("body").classList.remove("show-chat","show-people");
    $(".app-shell").classList.remove("people-mode");
    $("#peopleView").hidden=true;
    $("#inboxPanel").hidden=false;
    $("#chatPanel").hidden=false;
    $$(".nav-button").forEach(function(button){button.classList.toggle("is-active",button.dataset.view==="inbox");});
  }
  function showPeople(){
    $("body").classList.remove("show-chat");
    $("body").classList.add("show-people");
    $(".app-shell").classList.add("people-mode");
    $("#inboxPanel").hidden=false;
    $("#chatPanel").hidden=true;
    $("#peopleView").hidden=false;
    $$(".nav-button").forEach(function(button){button.classList.toggle("is-active",button.dataset.view==="people");});
    renderPeople($("#peopleSearch").value);
  }
  function addMessage(content){
    const person=currentConversation();
    if(!content)return;
    if(person.id==="everyone")sendGlobalMessage(content);
  }
  async function sendGlobalMessage(content,imagePath){
    if(!cloudConnected){showToast("Connect the shared backend before posting to the community.");return;}
    const button=$("#messageForm button[type=submit]");
    button.disabled=true;
    try{
      const message=await window.ChatshitCloud.sendMessage(content,identity.nickname||"Someone",imagePath||"");
      addCloudMessage(message);
      $("#messageInput").value="";
      resizeComposer();
      renderMessages();
    }catch(error){
      showToast("That message did not send. Check your connection and try again.");
    }finally{button.disabled=false;$("#attachButton").disabled=false;}
  }
  async function sendGlobalImage(file){
    if(!cloudConnected){showToast("Connect the shared backend before sharing images.");return;}
    if(!["image/jpeg","image/png","image/webp"].includes(file.type)){showToast("Choose a JPEG, PNG or WebP image.");return;}
    if(file.size>5*1024*1024){showToast("Choose an image smaller than 5 MB.");return;}
    const button=$("#attachButton");
    button.disabled=true;
    let uploaded=null;
    try{
      uploaded=await window.ChatshitCloud.uploadImage(file,"messages");
      const message=await window.ChatshitCloud.sendMessage($("#messageInput").value.trim(),identity.nickname||"Someone",uploaded.path);
      addCloudMessage(message);
      $("#messageInput").value="";
      resizeComposer();
      $("#emojiTray").hidden=true;
      renderMessages();
    }catch(error){
      if(uploaded)window.ChatshitCloud.removeMedia(uploaded.path).catch(function(){});
      showToast("Image could not be shared. Check your connection and media setup.");
    }finally{button.disabled=false;$("#imageInput").value="";}
  }
  function addCloudMessage(message){
    const room=findConversation("everyone");
    if(!room||room.messages.some(function(item){return item.id===message.id;}))return;
    room.messages.push(message);
    if(room.messages.length>100)room.messages.shift();
    if(activeId!=="everyone")room.unread+=1;
    if(activeId==="everyone")renderMessages();
    else renderConversations();
  }
  async function reloadCloudNotes(){
    if(!cloudConnected)return;
    try{
      cloudNotes=await window.ChatshitCloud.loadNotes();
      const mine=cloudNotes.find(function(note){return note.userId===window.ChatshitCloud.userId;});
      if(mine)myNote={text:mine.text,musicUrl:mine.musicUrl||"",expiresAt:mine.expiresAt,fromCloud:true};
      else if(myNote&&myNote.fromCloud)myNote=null;
      saveMyNote();
      renderNotes();
    }catch(error){showToast("Couldn’t refresh notes just now.");}
  }
  async function reloadCloudProfiles(){
    if(!cloudConnected)return;
    try{
      cloudProfiles=await window.ChatshitCloud.loadProfiles();
      profileDirectoryError=cloudProfiles.some(function(profile){return profile.userId===window.ChatshitCloud.userId;})?"":"Your profile is missing. Run the latest backend/supabase.sql, then refresh.";
    }catch(error){
      cloudProfiles=[];
      profileDirectoryError="The profiles table is not ready. Run the latest backend/supabase.sql, then refresh.";
    }
    renderPeople($("#peopleSearch").value);
  }
  async function reloadCloudStories(){
    if(!cloudConnected)return;
    try{
      cloudStories=await window.ChatshitCloud.loadStories();
    }catch(error){
      cloudStories=[];
      showToast("Stories could not load. Check the Supabase stories setup.");
    }
    renderStories();
  }
  async function connectCommunity(){
    const room=findConversation("everyone");
    if(!window.ChatshitCloud||!window.ChatshitCloud.configured){
      $("#inboxConnectionLabel").textContent="Not connected";
      $("#inboxModeLabel").textContent="Cloud setup needed";
      renderHeader();
      renderStories();
      renderNotes();
      renderPeople($("#peopleSearch").value);
      return;
    }
    $("#inboxConnectionLabel").textContent="Connecting…";
    try{
      await window.ChatshitCloud.connect(identity.nickname||"Someone");
      cloudConnected=true;
      try{await window.ChatshitCloud.saveProfile(identity.nickname||identity.username||"Someone");}
      catch(error){profileDirectoryError="The profiles table is not ready. Run the latest backend/supabase.sql, then refresh.";}
      $("#inboxConnectionLabel").textContent="Community room ready";
      $("#inboxModeLabel").textContent="Live chat";
      unsubscribeCloud=window.ChatshitCloud.subscribe(addCloudMessage,function(){reloadCloudNotes();},function(){reloadCloudProfiles();},function(){reloadCloudStories();});
      const [messages,notes,stories]=await Promise.all([window.ChatshitCloud.loadMessages(),window.ChatshitCloud.loadNotes(),window.ChatshitCloud.loadStories()]);
      const arrivals=room.messages.filter(function(message){return message.id&&CLOUD_ID.test(message.id)&&CLOUD_ID.test(message.userId||"");});
      const byId=new Map();
      messages.concat(arrivals).forEach(function(message){if(message.id)byId.set(message.id,message);});
      room.messages=Array.from(byId.values()).sort(function(a,b){return (a.createdAt||0)-(b.createdAt||0);}).slice(-100);
      cloudNotes=notes;
      cloudStories=stories;
      await reloadCloudProfiles();
      const mine=cloudNotes.find(function(note){return note.userId===window.ChatshitCloud.userId;});
      if(mine)myNote={text:mine.text,musicUrl:mine.musicUrl||"",expiresAt:mine.expiresAt,fromCloud:true};
      else if(myNote&&myNote.fromCloud)myNote=null;
      if(!mine&&myNote&&!myNote.fromCloud){await window.ChatshitCloud.saveNote(myNote.text,myNote.musicUrl,identity.nickname||"Someone");myNote.fromCloud=true;}
      saveMyNote();
      renderNotes();
      renderStories();
      renderMessages();
    }catch(error){
      cloudConnected=false;
      $("#inboxConnectionLabel").textContent="Not connected";
      $("#inboxModeLabel").textContent="Cloud connection issue";
      renderHeader();
      renderStories();
      renderNotes();
      showToast("Shared chat could not connect. Check the Supabase setup.");
    }
  }
  function renderPeople(query){
    const grid=$("#peopleCards");
    grid.replaceChildren();
    const q=(query||"").trim().toLowerCase();
    const hint=$("#peopleDirectoryHint");
    if(cloudConnected){
      if(profileDirectoryError){
        hint.textContent="Member list unavailable · check the Supabase profiles setup.";
        grid.appendChild(node("div","empty-note",profileDirectoryError));
        return;
      }
      hint.textContent=cloudProfiles.length+" registered member"+(cloudProfiles.length===1?"":"s")+" · updates live";
      const currentUserId=window.ChatshitCloud.userId;
      const found=cloudProfiles.filter(function(profile){return profile.displayName.toLowerCase().includes(q);});
      if(!found.length){grid.appendChild(node("div","empty-note",q?"No registered users match that name.":"No one has joined this community yet."));return;}
      found.forEach(function(profile,index){
        const isSelf=profile.userId===currentUserId;
        const member={name:profile.displayName,color:colors[index%colors.length],online:false};
        const card=node("article","person-card");
        card.appendChild(avatar(member));
        const copy=node("div","person-card-copy");
        copy.appendChild(node("strong","",profile.displayName));
        const joined=profile.createdAt?"Joined "+new Intl.DateTimeFormat(undefined,{month:"short",year:"numeric"}).format(new Date(profile.createdAt)):"Chatshit member";
        copy.appendChild(node("small","",(isSelf?"You · ":"Member · ")+joined));
        copy.appendChild(node("p","","A member of your Chatshit community."));
        card.appendChild(copy);
        card.appendChild(node("span","person-member-label",isSelf?"YOU":"MEMBER"));
        grid.appendChild(card);
      });
      return;
    }
    hint.textContent="Connect the shared backend to see real community members.";
    grid.appendChild(node("div","empty-note",q?"Search becomes available when the live directory is connected.":"No fake users here. Real members will appear after Supabase is set up."));
  }
  function openStoryGroup(stories){
    storyQueue=stories.filter(function(story){return Date.parse(story.expiresAt)>Date.now();}).sort(function(a,b){return Date.parse(a.createdAt)-Date.parse(b.createdAt);});
    if(!storyQueue.length){showToast("That story has expired.");return;}
    storyIndex=0;
    renderCurrentStory();
    $("#storyDialog").showModal();
  }
  function renderCurrentStory(){
    window.clearTimeout(storyAdvanceTimer);
    currentStory=storyQueue[storyIndex]||null;
    if(!currentStory)return;
    const isMine=currentStory.userId===window.ChatshitCloud.userId;
    const image=$("#storyImage");
    image.hidden=!currentStory.imageUrl;
    image.src=currentStory.imageUrl||"";
    $("#storyDialog").classList.toggle("has-image",Boolean(currentStory.imageUrl));
    $("#storyAvatar").textContent=initials(currentStory.displayName);
    $("#storyKicker").textContent=(isMine?"YOUR STORY":currentStory.displayName.toUpperCase())+" · "+(storyIndex+1)+" OF "+storyQueue.length;
    $("#storyText").textContent=currentStory.caption||"";
    $("#storyText").hidden=!currentStory.caption;
    $("#storyDeleteButton").hidden=!isMine;
    $("#storyPreviousButton").disabled=storyIndex===0;
    $("#storyNextButton").textContent=storyIndex===storyQueue.length-1?"Close":"Next";
    const progress=$("#storyProgressBar");
    progress.style.width="0";
    window.requestAnimationFrame(function(){if(currentStory&&$("#storyDialog").open)progress.style.width="100%";});
    storyAdvanceTimer=window.setTimeout(function(){
      if(storyIndex<storyQueue.length-1){storyIndex+=1;renderCurrentStory();}
      else $("#storyDialog").close();
    },7000);
  }
  function openStoryComposer(){
    if(!cloudConnected){showToast("Connect the shared backend before posting a story.");return;}
    $("#storyComposerForm").reset();
    $("#storyImagePreview").hidden=true;
    $("#storyImagePreview").removeAttribute("src");
    $("#storyComposerDialog").showModal();
    $("#storyCaption").focus();
  }
  async function publishStory(event){
    event.preventDefault();
    const caption=$("#storyCaption").value.trim();
    const file=$("#storyImageInput").files&&$("#storyImageInput").files[0];
    if(!caption&&!file){showToast("Add a photo or a few words to your story.");return;}
    if(!cloudConnected){showToast("Connect the shared backend before posting a story.");return;}
    const button=$("#publishStoryButton");
    button.disabled=true;
    let uploaded=null;
    try{
      if(file)uploaded=await window.ChatshitCloud.uploadImage(file,"stories");
      const story=await window.ChatshitCloud.createStory(caption,uploaded&&uploaded.path,identity.nickname||identity.username||"Someone");
      cloudStories=cloudStories.filter(function(item){return item.id!==story.id;});
      cloudStories.push(story);
      renderStories();
      $("#storyComposerDialog").close();
      showToast("Your story is live for 24 hours.");
    }catch(error){
      if(uploaded)window.ChatshitCloud.removeMedia(uploaded.path).catch(function(){});
      showToast("Your story could not be posted. Check the media and stories setup.");
    }finally{button.disabled=false;}
  }
  async function deleteCurrentStory(){
    if(!currentStory||currentStory.userId!==window.ChatshitCloud.userId)return;
    const story=currentStory;
    const button=$("#storyDeleteButton");
    button.disabled=true;
    try{
      await window.ChatshitCloud.deleteStory(story.id,story.imagePath);
      cloudStories=cloudStories.filter(function(item){return item.id!==story.id;});
      renderStories();
      $("#storyDialog").close();
      showToast("Your story was removed.");
    }catch(error){showToast("Your story could not be removed. Try again.");}
    finally{button.disabled=false;}
  }
  function showToast(message){
    const toast=$("#toast");
    toast.textContent=message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer=window.setTimeout(function(){toast.classList.remove("is-visible");},2600);
  }
  function resizeComposer(){
    const input=$("#messageInput");
    input.style.height="auto";
    input.style.height=Math.min(input.scrollHeight,96)+"px";
  }
  function applyTheme(theme){
    document.body.classList.toggle("dark",theme==="dark");
    try{localStorage.setItem(THEME_KEY,theme);}catch(error){}
  }
  function setupInstall(){
    if((window.matchMedia&&window.matchMedia("(display-mode: standalone)").matches)||navigator.standalone)$("#installAppButton").hidden=true;
    window.addEventListener("beforeinstallprompt",function(event){event.preventDefault();installPrompt=event;$("#installAppButton").classList.add("install-ready");});
    window.addEventListener("appinstalled",function(){installPrompt=null;$("#installAppButton").hidden=true;showToast("Chatshit is on your home screen ✨");});
    $("#installAppButton").addEventListener("click",async function(){
      if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;return;}
      const ios=/iphone|ipad|ipod/i.test(navigator.userAgent);
      showToast(ios?"Tap Share in Safari, then choose Add to Home Screen.":"Open your browser menu and tap Install app or Add to Home screen.");
    });
  }
  function init(){
    syncIdentity();
    saveConversations();
    renderStories();
    renderNotes();
    renderConversations();
    renderMessages();
    try{if(localStorage.getItem(THEME_KEY)==="dark")applyTheme("dark");}catch(error){}
    $$(".nav-button").forEach(function(button){
      button.addEventListener("click",function(){if(button.dataset.view==="people")showPeople();else if(button.dataset.view==="everyone")openConversation("everyone");else showInbox();});
    });
    $("#peopleSearch").addEventListener("input",function(){renderPeople(this.value);});
    $("#messageForm").addEventListener("submit",function(event){event.preventDefault();addMessage($("#messageInput").value.trim());});
    $("#messageInput").addEventListener("input",resizeComposer);
    $("#messageInput").addEventListener("keydown",function(event){
      if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();$("#messageForm").requestSubmit();}
    });
    $("#emojiButton").addEventListener("click",function(){const tray=$("#emojiTray");tray.hidden=!tray.hidden;});
    const tray=$("#emojiTray");
    emojis.forEach(function(emoji){
      const button=node("button","emoji-choice",emoji);
      button.type="button";
      button.addEventListener("click",function(){
        const input=$("#messageInput"),start=input.selectionStart,end=input.selectionEnd,value=input.value;
        input.value=value.slice(0,start)+emoji+value.slice(end);
        input.focus();
        input.setSelectionRange(start+emoji.length,start+emoji.length);
        resizeComposer();
        tray.hidden=true;
      });
      tray.appendChild(button);
    });
    $("#attachButton").addEventListener("click",function(){$("#imageInput").click();});
    $("#imageInput").addEventListener("change",async function(){
      const file=this.files&&this.files[0];
      if(!file)return;
      await sendGlobalImage(file);
      this.value="";
    });
    $("#editProfileButton").addEventListener("click",function(){$("#profileDialog").showModal();$("#profileName").focus();});
    $("#mobileProfileButton").addEventListener("click",function(){$("#profileDialog").showModal();$("#profileName").focus();});
    $("#saveProfileButton").addEventListener("click",async function(){
      const clean=$("#profileName").value.trim();
      if(!clean){showToast("Choose a name before saving.");return;}
      const updated=window.ChatshitIdentity.updateNickname(clean);
      if(updated){
        Object.assign(identity,updated);
        syncIdentity();
        renderStories();
        renderNotes();
        if(cloudConnected){
          try{await window.ChatshitCloud.saveProfile(identity.nickname||identity.username||"Someone");await reloadCloudProfiles();}
          catch(error){profileDirectoryError="Your profile could not be updated. Check the Supabase profiles table.";renderPeople($("#peopleSearch").value);}
        }
        $("#profileDialog").close();
        showToast(cloudConnected&&profileDirectoryError?"Name saved here, but the community profile could not update.":"Your little corner has your name on it now.");
      }
    });
    $("#yourStoryButton").addEventListener("click",openStoryComposer);
    $("#storyComposerForm").addEventListener("submit",publishStory);
    $("#closeStoryComposer").addEventListener("click",function(){$("#storyComposerDialog").close();});
    $("#storyComposerDialog").addEventListener("close",function(){
      const preview=$("#storyImagePreview");
      if(preview.dataset.objectUrl)URL.revokeObjectURL(preview.dataset.objectUrl);
      delete preview.dataset.objectUrl;
      preview.removeAttribute("src");
      preview.hidden=true;
    });
    $("#storyImageInput").addEventListener("change",function(){
      const file=this.files&&this.files[0];
      const preview=$("#storyImagePreview");
      if(!file){preview.hidden=true;preview.removeAttribute("src");return;}
      if(!["image/jpeg","image/png","image/webp"].includes(file.type)){showToast("Choose a JPEG, PNG or WebP image.");this.value="";preview.hidden=true;return;}
      if(file.size>5*1024*1024){showToast("Choose an image smaller than 5 MB.");this.value="";preview.hidden=true;return;}
      if(preview.dataset.objectUrl)URL.revokeObjectURL(preview.dataset.objectUrl);
      preview.dataset.objectUrl=URL.createObjectURL(file);
      preview.src=preview.dataset.objectUrl;
      preview.hidden=false;
    });
    $("#editNoteButton").addEventListener("click",openNoteEditor);
    $("#spotifyConnectButton").addEventListener("click",async function(){
      try{await window.ChatshitSpotify.connect();}
      catch(error){syncSpotifyControls({connected:spotifyConnected,track:spotifyNowPlaying,error:error.message},false);showToast(error.message||"Spotify could not connect.");}
    });
    $("#spotifyDisconnectButton").addEventListener("click",function(){
      window.ChatshitSpotify.disconnect();
      showToast("Spotify disconnected on this device.");
    });
    $("#spotifyUseTrackButton").addEventListener("click",function(){
      const track=window.ChatshitSpotify.getCurrentTrack();
      if(!track)return;
      $("#noteMusicUrl").value=track.url;
      $("#noteMusicUrl").focus();
      showToast("Spotify link added. Write your note, then share it.");
    });
    window.addEventListener("chatshit:spotify",function(event){syncSpotifyControls(event.detail,true);});
    window.ChatshitSpotify.init().then(function(state){syncSpotifyControls(state,true);}).catch(function(error){syncSpotifyControls({connected:false,error:error.message},false);});
    $("#closeNoteDialog").addEventListener("click",function(){$("#noteDialog").close();});
    $("#noteForm").addEventListener("submit",async function(event){
      event.preventDefault();
      const text=$("#noteText").value.trim();
      const rawUrl=$("#noteMusicUrl").value.trim();
      const musicUrl=validMusicUrl(rawUrl);
      if(!text){showToast("Add a few words to your note first.");$("#noteText").focus();return;}
      if(rawUrl&&!musicUrl){showToast("Paste a YouTube Music, Metrolist or Spotify HTTPS link.");$("#noteMusicUrl").focus();return;}
      const note={text:text,musicUrl:musicUrl,expiresAt:new Date(Date.now()+24*60*60*1000).toISOString()};
      if(cloudConnected){
        try{await window.ChatshitCloud.saveNote(text,musicUrl,identity.nickname||"Someone");note.fromCloud=true;}
        catch(error){showToast("Your note could not be shared. Try again in a moment.");return;}
      }
      myNote=note;
      saveMyNote();
      renderNotes();
      $("#noteDialog").close();
      showToast(cloudConnected?"Your note is up for everyone for 24 hours.":"Note saved here. Set up the cloud to share it with everyone.");
    });
    $("#closeStory").addEventListener("click",function(){$("#storyDialog").close();});
    $("#storyDialog").addEventListener("close",function(){window.clearTimeout(storyAdvanceTimer);storyQueue=[];currentStory=null;$("#storyImage").removeAttribute("src");});
    $("#storyPreviousButton").addEventListener("click",function(){if(storyIndex>0){storyIndex-=1;renderCurrentStory();}});
    $("#storyNextButton").addEventListener("click",function(){if(storyIndex<storyQueue.length-1){storyIndex+=1;renderCurrentStory();}else{$("#storyDialog").close();storyQueue=[];currentStory=null;}});
    $("#storyDeleteButton").addEventListener("click",deleteCurrentStory);
    $("#backToInbox").addEventListener("click",showInbox);
    $("#peopleBackButton").addEventListener("click",showInbox);
    $("#closeDetails").addEventListener("click",function(){$("#detailsPanel").classList.remove("detail-open");});
    $("#detailToggle").addEventListener("click",function(){$("#detailsPanel").classList.toggle("detail-open");});
    document.addEventListener("keydown",function(event){
      if(event.key==="Escape"){$("#emojiTray").hidden=true;$("#detailsPanel").classList.remove("detail-open");}
      if($("#storyDialog").open&&event.key==="ArrowRight")$("#storyNextButton").click();
      if($("#storyDialog").open&&event.key==="ArrowLeft")$("#storyPreviousButton").click();
    });
    const themeButton=node("button","theme-toggle");
    themeButton.type="button";
    themeButton.setAttribute("aria-label","Toggle dark mode");
    themeButton.title="A softer after-dark";
    themeButton.innerHTML='<svg class="icon"><use href="#i-moon"/></svg>';
    themeButton.addEventListener("click",function(){applyTheme(document.body.classList.contains("dark")?"light":"dark");});
    $(".inbox-heading").appendChild(themeButton);
    setupInstall();
    connectCommunity();
  }
  document.addEventListener("DOMContentLoaded",init);
})();
