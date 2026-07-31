import './style.css';

const API_URL = 'http://127.0.0.1:8000/api';

// DOM Elements
const pages = {
  landing: document.getElementById('page-landing'),
  auth: document.getElementById('page-auth'),
  dashboard: document.getElementById('page-dashboard')
};

const navLinks = document.getElementById('nav-links');
const navUser = document.getElementById('nav-user');
const creditsAmount = document.getElementById('credits-amount');

// Auth Form
const authForm = document.getElementById('auth-form');
const authTitle = document.getElementById('auth-title');
const btnAuthSubmit = document.getElementById('btn-auth-submit');
const switchToRegister = document.getElementById('switch-to-register');
const inputUsername = document.getElementById('auth-username');
const inputPassword = document.getElementById('auth-password');

// Dashboard & Generation
const promptInput = document.getElementById('ai-prompt');
const btnGenerate = document.getElementById('btn-generate');
const aiResultContainer = document.getElementById('ai-result-container');
const aiResult = document.getElementById('ai-result');
const btnCopy = document.getElementById('btn-copy');
const aiImageContainer = document.getElementById('ai-image-container');
const aiImageResult = document.getElementById('ai-image-result');
const btnDownloadImg = document.getElementById('btn-download-img');
const historyList = document.getElementById('history-list');
const btnMic = document.getElementById('btn-mic');
const aiTone = document.getElementById('ai-tone');
const aiPlatform = document.getElementById('ai-platform');

// Tabs
const tabText = document.getElementById('tab-text');
const tabImage = document.getElementById('tab-image');

// Settings Modal
const settingsModal = document.getElementById('settings-modal');
const closeSettings = document.getElementById('close-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');
const inputOpenaiKey = document.getElementById('input-openai-key');
const inputNewPassword = document.getElementById('input-new-password');
const linkSettings = document.getElementById('link-settings');

// Mobile Menu
const burgerMenu = document.getElementById('burger-menu');

// Stripe Modal
const stripeModal = document.getElementById('stripe-modal');
const closeStripe = document.getElementById('close-stripe');
const btnPayNow = document.getElementById('btn-pay-now');

// State
let isLoginMode = true;
let currentGenMode = 'text'; // 'text' or 'image'

// --- Utilities ---
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

function showPage(pageId) {
  Object.values(pages).forEach(page => {
    page.classList.remove('active');
    page.classList.add('hidden');
  });
  pages[pageId].classList.remove('hidden');
  pages[pageId].classList.add('active');
  window.scrollTo(0, 0);
}

function updateNav() {
  const token = localStorage.getItem('token');
  if (token) {
    navLinks.classList.add('hidden');
    navUser.classList.remove('hidden');
  } else {
    navLinks.classList.remove('hidden');
    navUser.classList.add('hidden');
  }
}

// --- API Calls ---
async function fetchMe() {
  const token = localStorage.getItem('token');
  try {
    const res = await fetch(`${API_URL}/me?token=${token}`);
    if (res.ok) {
      const user = await res.json();
      creditsAmount.textContent = user.credits;
      // Optional: fill settings inputs if needed, but password/key shouldn't be fully returned
      return user;
    }
  } catch (e) { console.error(e); }
  return null;
}

async function fetchHistory() {
  const token = localStorage.getItem('token');
  try {
    const res = await fetch(`${API_URL}/history?token=${token}`);
    if (res.ok) {
      const data = await res.json();
      renderHistory(data.history || []);
    }
  } catch (e) { console.error(e); }
}

function renderHistory(items) {
  historyList.innerHTML = '';
  if (items.length === 0) {
    historyList.innerHTML = '<p style="color:var(--text-secondary);font-size:0.9rem">История пуста. Создайте свой первый пост!</p>';
    return;
  }
  
  items.forEach(item => {
    const div = document.createElement('div');
    div.className = `history-item ${item.is_favorite ? 'favorite' : ''}`;
    const date = new Date(item.created_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
    
    div.innerHTML = `
      <div class="date">${date}</div>
      <div class="prompt">${item.prompt}</div>
      <div class="history-actions">
        <span class="action-icon fav-btn" title="В избранное">${item.is_favorite ? '⭐' : '☆'}</span>
        <span class="action-icon del-btn" title="Удалить">🗑️</span>
      </div>
    `;
    
    // Actions
    const favBtn = div.querySelector('.fav-btn');
    const delBtn = div.querySelector('.del-btn');
    
    favBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const token = localStorage.getItem('token');
      await fetch(`${API_URL}/history/${item.id}/favorite?token=${token}`, { method: 'POST' });
      fetchHistory();
    });
    
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const token = localStorage.getItem('token');
      await fetch(`${API_URL}/history/${item.id}?token=${token}`, { method: 'DELETE' });
      fetchHistory();
    });
    
    div.addEventListener('click', () => {
      if (item.content.startsWith('[IMAGE]')) {
        const url = item.content.replace('[IMAGE] ', '');
        aiImageResult.src = url;
        btnDownloadImg.href = url;
        aiImageContainer.classList.remove('hidden');
        aiResultContainer.classList.add('hidden');
        currentGenMode = 'image';
        updateTabs();
      } else {
        aiResult.innerHTML = item.content.replace(/\n/g, '<br>');
        aiResultContainer.classList.remove('hidden');
        aiImageContainer.classList.add('hidden');
        currentGenMode = 'text';
        updateTabs();
      }
    });
    historyList.appendChild(div);
  });
}

async function handleAuth(e) {
  e.preventDefault();
  const username = inputUsername.value;
  const password = inputPassword.value;
  const endpoint = isLoginMode ? '/login' : '/register';
  
  btnAuthSubmit.disabled = true;
  btnAuthSubmit.textContent = 'Подождите...';

  try {
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      showToast(data.detail || 'Ошибка авторизации', 'error');
    } else {
      if (isLoginMode) {
        localStorage.setItem('token', data.access_token);
        showToast('Успешный вход!', 'success');
        initApp();
      } else {
        showToast('Регистрация успешна! Выполняем вход...', 'success');
        // Auto-login after register
        isLoginMode = true;
        handleAuth(e);
      }
    }
  } catch (e) {
    showToast('Ошибка сети: Убедитесь, что сервер запущен', 'error');
  } finally {
    btnAuthSubmit.disabled = false;
    btnAuthSubmit.textContent = isLoginMode ? 'Войти' : 'Создать аккаунт';
  }
}

// Typing effect simulation
async function typeEffect(element, text, speed = 15) {
  element.innerHTML = '';
  element.classList.add('typing-cursor');
  
  const words = text.split(/(?<=\s)/); // Split by space keeping the space
  
  for (let i = 0; i < words.length; i++) {
    // Convert newlines to br
    const word = words[i].replace(/\n/g, '<br>');
    element.innerHTML += word;
    await new Promise(r => setTimeout(r, speed + Math.random() * 20));
  }
  
  element.classList.remove('typing-cursor');
}

// Voice Input
let recognition = null;
if ('webkitSpeechRecognition' in window) {
  recognition = new webkitSpeechRecognition();
  recognition.lang = 'ru-RU';
  recognition.interimResults = false;
  
  recognition.onresult = function(event) {
    const transcript = event.results[0][0].transcript;
    promptInput.value += (promptInput.value ? ' ' : '') + transcript;
    btnMic.classList.remove('recording');
  };
  
  recognition.onerror = function(event) {
    btnMic.classList.remove('recording');
    showToast('Ошибка микрофона', 'error');
  };
  
  recognition.onend = function() {
    btnMic.classList.remove('recording');
  };
}

btnMic.addEventListener('click', () => {
  if (!recognition) {
    showToast('Ваш браузер не поддерживает голосовой ввод', 'error');
    return;
  }
  if (btnMic.classList.contains('recording')) {
    recognition.stop();
  } else {
    recognition.start();
    btnMic.classList.add('recording');
  }
});

async function handleGenerate(e) {
  e.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt) {
    showToast('Напишите запрос', 'error');
    return;
  }
  
  const tone = aiTone.value;
  const platform = aiPlatform.value;
  
  const token = localStorage.getItem('token');
  
  btnGenerate.disabled = true;
  btnGenerate.innerHTML = '<span class="icon">⏳</span> Нейросеть думает...';
  aiResultContainer.classList.add('hidden');
  aiImageContainer.classList.add('hidden');
  
  const endpoint = currentGenMode === 'text' ? '/generate' : '/generate/image';
  
  try {
    const res = await fetch(`${API_URL}${endpoint}?token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, tone, platform })
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      showToast(data.detail || 'Ошибка генерации', 'error');
    } else {
      creditsAmount.textContent = data.remaining_credits;
      
      if (currentGenMode === 'text') {
        aiResultContainer.classList.remove('hidden');
        await typeEffect(aiResult, data.result);
        showToast('-10 💎 списано', 'success');
      } else {
        aiImageContainer.classList.remove('hidden');
        aiImageResult.src = data.result;
        btnDownloadImg.href = data.result;
        showToast('-20 💎 списано', 'success');
      }
      
      fetchHistory(); // Refresh history
    }
  } catch (e) {
    showToast('Ошибка сети', 'error');
  } finally {
    btnGenerate.disabled = false;
    btnGenerate.innerHTML = '<span class="icon">✨</span> Сгенерировать';
  }
}

function logout(e) {
  if (e) e.preventDefault();
  localStorage.removeItem('token');
  initApp();
}

// --- Event Listeners ---
function updateAuthUI() {
  authTitle.textContent = isLoginMode ? 'Вход в систему' : 'Создание аккаунта';
  btnAuthSubmit.textContent = isLoginMode ? 'Войти' : 'Создать аккаунт';
  
  const switchElement = document.getElementById('switch-to-register');
  const p = switchElement.parentElement;
  if (isLoginMode) {
    p.innerHTML = 'Нет аккаунта? <a href="#" id="switch-to-register">Создать аккаунт</a>';
  } else {
    p.innerHTML = 'Уже есть аккаунт? <a href="#" id="switch-to-register">Войти</a>';
  }
  
  document.getElementById('switch-to-register').addEventListener('click', (e) => {
    e.preventDefault();
    isLoginMode = !isLoginMode;
    updateAuthUI();
  });
}

document.getElementById('link-login').addEventListener('click', (e) => {
  e.preventDefault();
  isLoginMode = true; updateAuthUI(); showPage('auth');
});

document.getElementById('link-register').addEventListener('click', (e) => {
  e.preventDefault();
  isLoginMode = false; updateAuthUI(); showPage('auth');
});

document.getElementById('btn-hero-cta').addEventListener('click', (e) => {
  e.preventDefault();
  isLoginMode = false; updateAuthUI(); showPage('auth');
});

// --- Tabs & UI ---
function updateTabs() {
  if (currentGenMode === 'text') {
    tabText.classList.add('active');
    tabImage.classList.remove('active');
  } else {
    tabText.classList.remove('active');
    tabImage.classList.add('active');
  }
}

tabText.addEventListener('click', () => {
  currentGenMode = 'text';
  updateTabs();
  aiResultContainer.classList.add('hidden');
  aiImageContainer.classList.add('hidden');
});

tabImage.addEventListener('click', () => {
  currentGenMode = 'image';
  updateTabs();
  aiResultContainer.classList.add('hidden');
  aiImageContainer.classList.add('hidden');
});

// --- Burger Menu ---
burgerMenu.addEventListener('click', () => {
  burgerMenu.classList.toggle('active');
  const navContainer = localStorage.getItem('token') ? navUser : navLinks;
  navContainer.classList.toggle('active');
});

// Close menu on link click
document.querySelectorAll('.nav-links a, .nav-user a').forEach(link => {
  link.addEventListener('click', () => {
    burgerMenu.classList.remove('active');
    navLinks.classList.remove('active');
    navUser.classList.remove('active');
  });
});

// --- Stripe Modal ---
function openStripeModal() {
  stripeModal.classList.remove('hidden');
}

closeStripe.addEventListener('click', () => {
  stripeModal.classList.add('hidden');
});

btnPayNow.addEventListener('click', () => {
  btnPayNow.textContent = 'Обработка...';
  setTimeout(() => {
    stripeModal.classList.add('hidden');
    btnPayNow.textContent = 'Оплатить $19';
    showToast('Оплата прошла успешно! Вы теперь Pro Creator 🎉', 'success');
  }, 1500);
});

document.getElementById('btn-price-pro').addEventListener('click', (e) => {
  e.preventDefault();
  openStripeModal();
});

// --- Settings Modal ---
linkSettings.addEventListener('click', (e) => {
  e.preventDefault();
  settingsModal.classList.remove('hidden');
});

closeSettings.addEventListener('click', () => {
  settingsModal.classList.add('hidden');
});

btnSaveSettings.addEventListener('click', async () => {
  const openai_key = inputOpenaiKey.value.trim();
  const password = inputNewPassword.value.trim();
  const token = localStorage.getItem('token');
  
  btnSaveSettings.textContent = 'Сохранение...';
  try {
    const res = await fetch(`${API_URL}/settings?token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ openai_key, password })
    });
    if (res.ok) {
      showToast('Настройки сохранены', 'success');
      settingsModal.classList.add('hidden');
      inputNewPassword.value = '';
    } else {
      showToast('Ошибка сохранения', 'error');
    }
  } catch (e) {
    showToast('Ошибка сети', 'error');
  }
  btnSaveSettings.textContent = 'Сохранить изменения';
});

document.querySelector('.logo').addEventListener('click', (e) => {
  e.preventDefault();
  initApp();
});

document.getElementById('link-dashboard').addEventListener('click', async (e) => {
  e.preventDefault();
  const user = await fetchMe();
  if (user) showPage('dashboard');
});

document.getElementById('link-logout').addEventListener('click', logout);
authForm.addEventListener('submit', handleAuth);
btnGenerate.addEventListener('click', handleGenerate);

btnCopy.addEventListener('click', () => {
  const text = aiResult.innerText;
  navigator.clipboard.writeText(text);
  const oldText = btnCopy.textContent;
  btnCopy.textContent = 'Скопировано! ✓';
  setTimeout(() => btnCopy.textContent = oldText, 2000);
});

// --- Initialization ---
async function initApp() {
  updateAuthUI();
  updateNav();
  const token = localStorage.getItem('token');
  if (token) {
    const user = await fetchMe();
    if (user) {
      showPage('dashboard');
      fetchHistory();
    } else {
      showPage('landing');
    }
  } else {
    showPage('landing');
  }
}

initApp();
