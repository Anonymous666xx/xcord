var API_BASE = 'https://discord-club.itsjust.workers.dev';
var WS_URL = 'wss://discord-club.itsjust.workers.dev/ws';

var state = {
  token: localStorage.getItem('token'),
  user: null,
  friends: [],
  friendRequests: [],
  onlineUsers: {},
  messages: [],
  activeChannel: 'general',
  activeGuild: 'home',
  ws: null,
  typing: false,
  peerConnection: null,
  localStream: null,
  remoteStream: null,
  inCall: false,
  callType: null,
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

var MediaDevices = { audioIn: [], audioOut: [], videoIn: [] };
var currentCall = { userId: null, polite: false, makingOffer: false, ignoreOffer: false };

function qs(id) { return document.getElementById(id); }
function qsa(sel) { return document.querySelectorAll(sel); }

// ===================== AUTH =====================
var loginBtn = qs('loginBtn');
var registerBtn = qs('registerBtn');
var showRegister = qs('showRegister');
var showLogin = qs('showLogin');
var loginUsername = qs('loginUsername');
var loginPassword = qs('loginPassword');
var regUsername = qs('regUsername');
var regPassword = qs('regPassword');
var regConfirm = qs('regConfirm');
var authError = qs('authError');
var regError = qs('regError');
var authScreen = qs('authScreen');
var mainApp = qs('mainApp');

showRegister.addEventListener('click', function(e) {
  e.preventDefault();
  qs('loginForm').style.display = 'none';
  qs('registerForm').style.display = 'block';
  authError.textContent = '';
});

showLogin.addEventListener('click', function(e) {
  e.preventDefault();
  qs('loginForm').style.display = 'block';
  qs('registerForm').style.display = 'none';
  regError.textContent = '';
});

loginBtn.addEventListener('click', login);
loginPassword.addEventListener('keydown', function(e) { if (e.key === 'Enter') login(); });
registerBtn.addEventListener('click', register);

async function login() {
  var u = loginUsername.value.trim();
  var p = loginPassword.value.trim();
  if (!u || !p) { authError.textContent = 'Please fill in all fields.'; return; }
  authError.textContent = '';
  loginBtn.textContent = 'Logging in...';
  loginBtn.disabled = true;
  try {
    var res = await fetch(API_BASE + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p })
    });
    var data = await res.json();
    if (!res.ok) { authError.textContent = data.error || 'Login failed.'; return; }
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('token', state.token);
    loginBtn.textContent = 'Log In';
    loginBtn.disabled = false;
    onAuthSuccess();
  } catch(e) {
    authError.textContent = 'Cannot connect to server.';
    loginBtn.textContent = 'Log In';
    loginBtn.disabled = false;
  }
}

async function register() {
  var u = regUsername.value.trim();
  var p = regPassword.value.trim();
  var c = regConfirm.value.trim();
  if (!u || !p || !c) { regError.textContent = 'Please fill in all fields.'; return; }
  if (p !== c) { regError.textContent = 'Passwords do not match.'; return; }
  if (u.length < 2) { regError.textContent = 'Username must be at least 2 characters.'; return; }
  if (p.length < 4) { regError.textContent = 'Password must be at least 4 characters.'; return; }
  regError.textContent = '';
  registerBtn.textContent = 'Creating...';
  registerBtn.disabled = true;
  try {
    var res = await fetch(API_BASE + '/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p })
    });
    var data = await res.json();
    if (!res.ok) { regError.textContent = data.error || 'Registration failed.'; return; }
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('token', state.token);
    registerBtn.textContent = 'Create Account';
    registerBtn.disabled = false;
    onAuthSuccess();
  } catch(e) {
    regError.textContent = 'Cannot connect to server.';
    registerBtn.textContent = 'Create Account';
    registerBtn.disabled = false;
  }
}

function onAuthSuccess() {
  authScreen.style.display = 'none';
  mainApp.style.display = 'flex';
  loadUserData();
  connectWebSocket();
  loadFriends();
  loadPendingRequests();
  loadMessages('general');
  setupDevices();
}

qs('logoutBtn').addEventListener('click', function() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('token');
  if (state.ws) state.ws.close();
  if (state.inCall) endCall();
  mainApp.style.display = 'none';
  authScreen.style.display = 'flex';
  loginUsername.value = ''; loginPassword.value = '';
  regUsername.value = ''; regPassword.value = ''; regConfirm.value = '';
  qs('loginForm').style.display = 'block';
  qs('registerForm').style.display = 'none';
});

// Check for existing token
if (state.token) {
  (async function() {
    try {
      var res = await fetch(API_BASE + '/api/me', { headers: { 'Authorization': 'Bearer ' + state.token } });
      if (res.ok) {
        var data = await res.json();
        state.user = data.user;
        onAuthSuccess();
      } else {
        localStorage.removeItem('token');
        state.token = null;
      }
    } catch(e) {
      localStorage.removeItem('token');
      state.token = null;
    }
  })();
}

// ===================== USER DATA =====================
function loadUserData() {
  if (!state.user) return;
  qs('userFooterName').textContent = state.user.displayName || state.user.username;
  qs('userAvatar').textContent = (state.user.displayName || state.user.username)[0].toUpperCase();
  qs('settingsDisplayName').value = state.user.displayName || '';
  qs('settingsBio').value = state.user.bio || '';
}

// ===================== WEBSOCKET =====================
function connectWebSocket() {
  if (state.ws) state.ws.close();
  try {
    state.ws = new WebSocket(WS_URL + '?token=' + encodeURIComponent(state.token));
    state.ws.onmessage = function(e) {
      try { handleWSMessage(JSON.parse(e.data)); } catch(ex) {}
    };
    state.ws.onclose = function() { setTimeout(connectWebSocket, 3000); };
    state.ws.onerror = function() {};
  } catch(e) {}
}

function handleWSMessage(msg) {
  switch (msg.type) {
    case 'message':
      if (msg.channel === state.activeChannel) appendMessage(msg);
      break;
    case 'presence':
      if (msg.online) state.onlineUsers[msg.userId] = msg.username;
      else delete state.onlineUsers[msg.userId];
      renderOnlineUsers();
      break;
    case 'friend_request':
      notify('Friend request from ' + msg.from, 'info');
      loadPendingRequests();
      break;
    case 'friend_accepted':
      notify(msg.from + ' accepted your friend request!', 'success');
      loadFriends();
      break;
    case 'friend_removed':
      loadFriends();
      break;
    case 'call_offer':
      if (!state.inCall) handleCallOffer(msg);
      break;
    case 'call_answer':
      handleCallAnswer(msg);
      break;
    case 'call_ice':
      handleCallICE(msg);
      break;
    case 'call_end':
      if (state.inCall) endCall();
      notify('Call ended.', 'info');
      break;
  }
}

// ===================== CHANNELS =====================
qsa('.sidebar-item').forEach(function(el) {
  el.addEventListener('click', function() {
    qsa('.sidebar-item').forEach(function(c) { c.classList.remove('active'); });
    el.classList.add('active');
    state.activeChannel = el.dataset.channel;
    qs('channelName').textContent = state.activeChannel;
    qs('messageInput').placeholder = 'Message #' + state.activeChannel;
    loadMessages(state.activeChannel);
  });
});



// ===================== MESSAGES =====================
async function loadMessages(channel) {
  try {
    var res = await fetch(API_BASE + '/api/channels/' + channel + '/messages', {
      headers: { 'Authorization': 'Bearer ' + state.token }
    });
    if (res.ok) {
      state.messages = await res.json();
      renderMessages();
    }
  } catch(e) {}
}

function renderMessages() {
  var container = qs('messages');
  container.innerHTML = '';
  state.messages.forEach(function(m) { appendMessage(m); });
  container.scrollTop = container.scrollHeight;
}

function appendMessage(m) {
  var container = qs('messages');
  var el = document.createElement('div');
  el.className = 'message';
  var avatarColor = stringToColor(m.author);
  el.innerHTML = '<div class="message-avatar" style="background:' + avatarColor + '">'
    + m.author[0].toUpperCase() + '</div>'
    + '<div class="message-content"><div class="message-header">'
    + '<span class="message-author">' + escapeHtml(m.author) + '</span>'
    + '<span class="message-time">' + formatTime(m.timestamp || Date.now()) + '</span></div>'
    + '<div class="message-text">' + escapeHtml(m.content) + '</div></div>';
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

var sendBtn = qs('sendBtn');
var messageInput = qs('messageInput');

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

async function sendMessage() {
  var content = messageInput.value.trim();
  if (!content) return;
  messageInput.value = '';
  try {
    var res = await fetch(API_BASE + '/api/channels/' + state.activeChannel + '/messages', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + state.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content })
    });
    if (!res.ok) return;
    var msg = await res.json();
    appendMessage(msg);
  } catch(e) {}
}

// ===================== FRIENDS =====================
async function loadFriends() {
  try {
    var res = await fetch(API_BASE + '/api/friends', {
      headers: { 'Authorization': 'Bearer ' + state.token }
    });
    if (res.ok) {
      state.friends = await res.json();
      renderFriends();
    }
  } catch(e) {}
}

function renderFriends() {
  var list = qs('friendsList');
  if (!state.friends.length) {
    list.innerHTML = '<div class="friend-item"><div class="friend-info"><div class="friend-name" style="color:var(--text-muted)">No friends yet</div></div></div>';
    return;
  }
  list.innerHTML = state.friends.map(function(f) {
    var name = f.displayName || f.username;
    return '<div class="friend-item">'
      + '<div class="friend-avatar" style="background:' + stringToColor(name) + '">' + name[0].toUpperCase() + '</div>'
      + '<div class="friend-info"><div class="friend-name">' + escapeHtml(name) + '</div>'
      + '<div class="friend-status">' + (state.onlineUsers[f.id] ? 'Online' : 'Offline') + '</div></div>'
      + '<div class="friend-actions">'
      + '<button class="friend-action-btn call-friend" data-id="' + f.id + '" data-name="' + escapeHtml(name) + '" title="Call">📞</button>'
      + '<button class="friend-action-btn remove" data-id="' + f.id + '" title="Remove">✕</button></div></div>';
  }).join('');

  list.querySelectorAll('.call-friend').forEach(function(btn) {
    btn.addEventListener('click', function() {
      startCall(this.dataset.id, this.dataset.name, 'voice');
    });
  });
  list.querySelectorAll('.friend-item .remove').forEach(function(btn) {
    btn.addEventListener('click', function() { removeFriend(this.dataset.id); });
  });
}

async function loadPendingRequests() {
  try {
    var res = await fetch(API_BASE + '/api/friends/requests', {
      headers: { 'Authorization': 'Bearer ' + state.token }
    });
    if (res.ok) {
      state.friendRequests = await res.json();
    }
  } catch(e) {}
}

function showPendingRequests() {
  var list = qs('pendingRequestsList');
  if (!state.friendRequests.length) {
    list.innerHTML = '<p class="modal-desc">No pending requests.</p>';
  } else {
    list.innerHTML = state.friendRequests.map(function(r) {
      var name = r.displayName || r.username;
      return '<div class="pending-request-item">'
        + '<div class="pending-request-avatar" style="background:' + stringToColor(name) + '">' + name[0].toUpperCase() + '</div>'
        + '<span class="pending-request-name">' + escapeHtml(name) + '</span>'
        + '<div class="pending-request-actions">'
        + '<button class="pending-accept-btn" data-id="' + r.id + '">Accept</button>'
        + '<button class="pending-reject-btn" data-id="' + r.id + '">Reject</button></div></div>';
    }).join('');
    list.querySelectorAll('.pending-accept-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { acceptFriend(this.dataset.id); });
    });
    list.querySelectorAll('.pending-reject-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { rejectFriend(this.dataset.id); });
    });
  }
  qs('pendingRequestsModal').classList.add('active');
}

async function sendFriendRequest(username) {
  try {
    var res = await fetch(API_BASE + '/api/friends/request', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + state.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username })
    });
    var data = await res.json();
    if (!res.ok) { qs('friendRequestError').textContent = data.error || 'Failed to send request.'; return false; }
    notify('Friend request sent to ' + username, 'success');
    qs('friendRequestInput').value = '';
    qs('friendRequestError').textContent = '';
    return true;
  } catch(e) {
    qs('friendRequestError').textContent = 'Cannot connect to server.';
    return false;
  }
}

async function acceptFriend(id) {
  await fetch(API_BASE + '/api/friends/accept', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + state.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: id })
  });
  loadPendingRequests();
  loadFriends();
}

async function rejectFriend(id) {
  await fetch(API_BASE + '/api/friends/reject', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + state.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: id })
  });
  loadPendingRequests();
}

async function removeFriend(id) {
  await fetch(API_BASE + '/api/friends/' + id, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + state.token }
  });
  loadFriends();
}

// ===================== ONLINE USERS =====================
function renderOnlineUsers() {
  var container = qs('onlineUsers');
  var ids = Object.keys(state.onlineUsers);
  qs('onlineCount').textContent = ids.length;
  if (!ids.length) {
    container.innerHTML = '<div class="online-user"><div class="online-user-name" style="color:var(--text-muted)">No one online</div></div>';
    return;
  }
  container.innerHTML = ids.map(function(id) {
    var name = state.onlineUsers[id];
    return '<div class="online-user">'
      + '<div class="online-user-avatar" style="background:' + stringToColor(name) + '">' + name[0].toUpperCase() + '</div>'
      + '<span class="online-user-name">' + escapeHtml(name) + '</span></div>';
  }).join('');
}

// ===================== FRIEND REQUEST MODAL =====================
function openFriendModal() {
  var modal = qs('friendRequestModal');
  modal.classList.add('active');
  qs('friendRequestInput').focus();
}

qs('addFriendBtn').addEventListener('click', openFriendModal);
qs('friendsBtn').addEventListener('click', openFriendModal);

qs('closeFriendModal').addEventListener('click', function() {
  qs('friendRequestModal').classList.remove('active');
  qs('friendRequestError').textContent = '';
  qs('friendRequestInput').value = '';
});

qs('sendFriendRequestBtn').addEventListener('click', function() {
  var username = qs('friendRequestInput').value.trim();
  if (username) sendFriendRequest(username);
});

qs('friendRequestInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    var username = qs('friendRequestInput').value.trim();
    if (username) sendFriendRequest(username);
  }
});

// Pending requests
qs('pendingBtn').addEventListener('click', function() {
  loadPendingRequests();
  showPendingRequests();
});

qs('closePendingModal').addEventListener('click', function() {
  qs('pendingRequestsModal').classList.remove('active');
});

// ===================== SETTINGS =====================
qs('settingsBtn').addEventListener('click', function() {
  qs('settingsModal').classList.add('active');
});

qs('closeSettingsModal').addEventListener('click', function() {
  qs('settingsModal').classList.remove('active');
});

qs('saveProfileBtn').addEventListener('click', async function() {
  var displayName = qs('settingsDisplayName').value.trim();
  var bio = qs('settingsBio').value.trim();
  if (!displayName) { notify('Display name cannot be empty.', 'error'); return; }
  try {
    var res = await fetch(API_BASE + '/api/profile', {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + state.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: displayName, bio: bio })
    });
    if (res.ok) {
      state.user.displayName = displayName;
      state.user.bio = bio;
      qs('userFooterName').textContent = displayName;
      notify('Profile updated!', 'success');
      qs('settingsModal').classList.remove('active');
    }
  } catch(e) {
    notify('Failed to save profile.', 'error');
  }
});

// ===================== CALLS (WebRTC) =====================
qs('callBtn').addEventListener('click', function() {
  if (!state.inCall) startCall(null, null, 'voice');
  else endCall();
});

qs('videoCallBtn').addEventListener('click', function() {
  if (!state.inCall) startCall(null, null, 'video');
  else endCall();
});

qs('screenshareBtn').addEventListener('click', function() {
  if (!state.inCall) startCall(null, null, 'screenshare');
  else endCall();
});

qs('endCallBtn').addEventListener('click', endCall);

async function startCall(userId, userName, type) {
  if (state.inCall) return;
  state.callType = type;
  state.inCall = true;
  qs('callOverlay').style.display = 'flex';
  qs('chatArea').style.display = 'none';
  qs('callStatus').textContent = userId ? 'Calling ' + userName + '...' : 'Starting ' + type + ' call...';

  if (type === 'screenshare') {
    try {
      state.localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch(e) {
      notify('Screen share cancelled or failed.', 'error');
      endCall();
      return;
    }
    qs('localVideo').srcObject = state.localStream;
  } else if (type === 'video') {
    try {
      state.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      qs('localVideo').srcObject = state.localStream;
    } catch(e) {
      notify('Camera/mic access denied.', 'error');
      state.callType = 'voice';
    }
  } else {
    try {
      state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch(e) {
      notify('Mic access denied.', 'error');
      endCall();
      return;
    }
  }

  if (userId) {
    // Calling a specific user
    currentCall.userId = userId;
    createPeerConnection();
    if (state.localStream) {
      state.localStream.getTracks().forEach(function(track) {
        state.peerConnection.addTrack(track, state.localStream);
      });
    }
    var offer = await state.peerConnection.createOffer();
    await state.peerConnection.setLocalDescription(offer);
    currentCall.makingOffer = true;
    sendWS({ type: 'call_offer', to: userId, offer: offer, callType: type });
  } else {
    // Broadcast call to channel - send to all online friends
    var peers = Object.keys(state.onlineUsers);
    if (!peers.length) { notify('No one online to call.', 'info'); endCall(); return; }
    for (var i = 0; i < peers.length; i++) {
      currentCall.userId = peers[0];
      break;
    }
    createPeerConnection();
    if (state.localStream) {
      state.localStream.getTracks().forEach(function(track) {
        state.peerConnection.addTrack(track, state.localStream);
      });
    }
    var offer = await state.peerConnection.createOffer();
    await state.peerConnection.setLocalDescription(offer);
    currentCall.makingOffer = true;
    sendWS({ type: 'call_offer', to: currentCall.userId, offer: offer, callType: type });
  }
}

function createPeerConnection() {
  state.peerConnection = new RTCPeerConnection({ iceServers: state.iceServers });

  state.peerConnection.onicecandidate = function(e) {
    if (e.candidate && currentCall.userId) {
      sendWS({ type: 'call_ice', to: currentCall.userId, candidate: e.candidate });
    }
  };

  state.peerConnection.ontrack = function(e) {
    state.remoteStream = e.streams[0];
    qs('remoteVideo').srcObject = state.remoteStream;
    qs('callStatus').style.display = 'none';
  };

  state.peerConnection.onconnectionstatechange = function() {
    if (state.peerConnection.connectionState === 'disconnected' || state.peerConnection.connectionState === 'failed') {
      notify('Call disconnected.', 'info');
      endCall();
    }
  };
}

async function handleCallOffer(msg) {
  if (state.inCall) { sendWS({ type: 'call_end', to: msg.from }); return; }
  state.inCall = true;
  state.callType = msg.callType || 'voice';
  currentCall.userId = msg.from;
  currentCall.polite = true;
  qs('callOverlay').style.display = 'flex';
  qs('chatArea').style.display = 'none';
  qs('callStatus').textContent = 'Incoming ' + (msg.callType || 'voice') + ' call from ' + msg.fromName + '...';

  try {
    if (msg.callType === 'voice') {
      state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } else {
      try {
        state.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        qs('localVideo').srcObject = state.localStream;
      } catch(e) {
        state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
    }
  } catch(e) {
    notify('Mic access denied.', 'error');
    endCall();
    return;
  }

  createPeerConnection();
  if (state.localStream) {
    state.localStream.getTracks().forEach(function(track) {
      state.peerConnection.addTrack(track, state.localStream);
    });
  }

  try {
    var desc = new RTCSessionDescription(msg.offer);
    await state.peerConnection.setRemoteDescription(desc);
    var answer = await state.peerConnection.createAnswer();
    await state.peerConnection.setLocalDescription(answer);
    sendWS({ type: 'call_answer', to: msg.from, answer: answer });
  } catch(e) {
    endCall();
  }
}

async function handleCallAnswer(msg) {
  if (!state.peerConnection) return;
  try {
    var desc = new RTCSessionDescription(msg.answer);
    await state.peerConnection.setRemoteDescription(desc);
  } catch(e) {}
}

async function handleCallICE(msg) {
  if (!state.peerConnection) return;
  try {
    var candidate = new RTCIceCandidate(msg.candidate);
    await state.peerConnection.addIceCandidate(candidate);
  } catch(e) {}
}

function endCall() {
  if (state.peerConnection) {
    state.peerConnection.close();
    state.peerConnection = null;
  }
  if (state.localStream) {
    state.localStream.getTracks().forEach(function(t) { t.stop(); });
    state.localStream = null;
  }
  if (state.remoteStream) {
    state.remoteStream.getTracks().forEach(function(t) { t.stop(); });
    state.remoteStream = null;
  }
  if (currentCall.userId) {
    sendWS({ type: 'call_end', to: currentCall.userId });
  }
  state.inCall = false;
  currentCall.userId = null;
  currentCall.polite = false;
  currentCall.makingOffer = false;
  qs('callOverlay').style.display = 'none';
  qs('chatArea').style.display = 'flex';
  qs('localVideo').srcObject = null;
  qs('remoteVideo').srcObject = null;
  qs('callStatus').style.display = 'block';
}

function sendWS(data) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(data));
  }
}

// ===================== MEDIA DEVICES =====================
async function setupDevices() {
  try {
    var devices = await navigator.mediaDevices.enumerateDevices();
    devices.forEach(function(d) {
      if (d.kind === 'audioinput') MediaDevices.audioIn.push(d);
      if (d.kind === 'audiooutput') MediaDevices.audioOut.push(d);
      if (d.kind === 'videoinput') MediaDevices.videoIn.push(d);
    });
    populateDeviceSelect(qs('audioInputSelect'), MediaDevices.audioIn);
    populateDeviceSelect(qs('audioOutputSelect'), MediaDevices.audioOut);
    populateDeviceSelect(qs('videoInputSelect'), MediaDevices.videoIn);
  } catch(e) {}
}

function populateDeviceSelect(select, devices) {
  select.innerHTML = devices.map(function(d) {
    return '<option value="' + d.deviceId + '">' + (d.label || d.kind) + '</option>';
  }).join('');
}

// ===================== NOTIFICATIONS =====================
function notify(text, type) {
  var container = qs('notificationContainer');
  var el = document.createElement('div');
  el.className = 'notification ' + (type || 'info');
  el.textContent = text;
  container.appendChild(el);
  setTimeout(function() { el.remove(); }, 4000);
}

// ===================== UTILITIES =====================
function escapeHtml(str) {
  var d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function formatTime(ts) {
  var d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function stringToColor(str) {
  var hash = 0;
  for (var i = 0; i < str.length; i++) { hash = str.charCodeAt(i) + ((hash << 5) - hash); }
  var colors = ['#5865f2','#ed4245','#57f287','#fee75c','#eb459e','#00b0f4','#9b59b6','#1abc9c','#e67e22','#2ecc71'];
  return colors[Math.abs(hash) % colors.length];
}
