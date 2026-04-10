// DOM Elements
const statusBadge = document.getElementById('statusBadge');
const warningBox = document.getElementById('warningBox');
const mainContent = document.getElementById('mainContent');
const productsLoading = document.getElementById('productsLoading');
const productsEmpty = document.getElementById('productsEmpty');
const productsList = document.getElementById('productsList');
const refreshProducts = document.getElementById('refreshProducts');
const dateStart = document.getElementById('dateStart');
const dateEnd = document.getElementById('dateEnd');
const datePreview = document.getElementById('datePreview');
const executeBtn = document.getElementById('executeBtn');
const clearBtn = document.getElementById('clearBtn');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const resultSection = document.getElementById('resultSection');
const totalValue = document.getElementById('totalValue');
const copyTotalBtn = document.getElementById('copyTotalBtn');

// State
let products = [];
let savedState = {};
let isConnected = false;
let currentTabId = null;
let productsFrameId = null;

const STORAGE_KEY = 'sefaz_editor_state';

// Save state
async function saveState() {
  const state = {
    products: products.map(p => ({
      code: p.code,
      description: p.description,
      unitValue: p.unitValue,
      newQty: p.newQty || '',
      completed: p.completed || false
    })),
    dateStart: dateStart.value,
    dateEnd: dateEnd.value,
    timestamp: Date.now()
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

// Load state
async function loadState() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  savedState = result[STORAGE_KEY] || {};
  return savedState;
}

// Clear state
async function clearState() {
  await chrome.storage.local.remove(STORAGE_KEY);
  savedState = {};
  dateStart.value = '';
  dateEnd.value = '';
  updateDatePreview();
  products.forEach(p => {
    p.newQty = '';
    p.completed = false;
  });
  renderProducts();
  updateExecuteButton();
  resultSection.style.display = 'none';
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadState();
  await checkConnection();
  setupEventListeners();
});

// Check connection
async function checkConnection() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab.id;
    
    if (tab.url && tab.url.includes('nfe-extranet.sefazrs.rs.gov.br')) {
      setConnected(true);
      await loadProducts();
    } else {
      setConnected(false);
    }
  } catch (error) {
    setConnected(false);
  }
}

function setConnected(connected) {
  isConnected = connected;
  const statusText = statusBadge.querySelector('.status-text');
  
  if (connected) {
    statusBadge.classList.add('connected');
    statusBadge.classList.remove('disconnected');
    statusText.textContent = 'OK';
    warningBox.style.display = 'none';
    mainContent.style.display = 'flex';
  } else {
    statusBadge.classList.add('disconnected');
    statusBadge.classList.remove('connected');
    statusText.textContent = 'OFF';
    warningBox.style.display = 'block';
    mainContent.style.opacity = '0.5';
    mainContent.style.pointerEvents = 'none';
  }
}

// Load products
async function loadProducts() {
  productsLoading.style.display = 'flex';
  productsEmpty.style.display = 'none';
  productsList.style.display = 'none';
  
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId: currentTabId });
    let allProducts = [];
    
    if (frames) {
      for (const frame of frames) {
        try {
          const response = await chrome.tabs.sendMessage(currentTabId, { action: 'getProducts' }, { frameId: frame.frameId });
          if (response?.products?.length > 0) {
            allProducts = response.products;
            productsFrameId = frame.frameId;
            break;
          }
        } catch (e) {}
      }
    }
    
    if (allProducts.length > 0) {
      products = allProducts.map(p => {
        const saved = savedState.products?.find(sp => sp.code === p.code);
        return {
          ...p,
          newQty: saved?.newQty || '',
          completed: saved?.completed || false
        };
      });
      
      if (savedState.dateStart) dateStart.value = savedState.dateStart;
      if (savedState.dateEnd) dateEnd.value = savedState.dateEnd;
      updateDatePreview();
      
      renderProducts();
      productsLoading.style.display = 'none';
      productsList.style.display = 'flex';
    } else {
      productsLoading.style.display = 'none';
      productsEmpty.style.display = 'flex';
    }
  } catch (error) {
    productsLoading.style.display = 'none';
    productsEmpty.style.display = 'flex';
  }
}

// Render products
function renderProducts() {
  productsList.innerHTML = '';
  
  products.forEach((product, index) => {
    const item = document.createElement('div');
    item.className = 'product-item' + (product.completed ? ' completed' : '');
    
    const inputClass = product.newQty ? 'product-qty-input filled' : 'product-qty-input';
    
    item.innerHTML = `
      <div class="product-info">
        <div class="product-name">${product.description}</div>
        <div class="product-details">Cód: ${product.code} | V.U: ${product.unitValue || '-'}</div>
      </div>
      <input type="text" class="${inputClass}" data-index="${index}" placeholder="Qtd" value="${product.newQty || ''}" ${product.completed ? 'disabled' : ''}>
    `;
    
    productsList.appendChild(item);
  });
  
  document.querySelectorAll('.product-qty-input').forEach(input => {
    input.addEventListener('input', handleQtyInput);
    input.addEventListener('change', () => saveState());
  });
  
  updateExecuteButton();
}

function handleQtyInput(e) {
  const index = parseInt(e.target.dataset.index);
  const value = e.target.value.replace(/[^\d,\.]/g, '');
  e.target.value = value;
  products[index].newQty = value;
  
  e.target.classList.toggle('filled', !!value);
  updateExecuteButton();
}

function formatDateInput(input) {
  let value = input.value.replace(/\D/g, '');
  if (value.length >= 2) {
    value = value.slice(0, 2) + '/' + value.slice(2, 4);
  }
  input.value = value;
  input.classList.toggle('filled', value.length === 5);
  updateDatePreview();
  saveState();
}

function updateDatePreview() {
  const start = dateStart.value || '__/__';
  const end = dateEnd.value || '__/__';
  datePreview.textContent = `De ${start} a ${end}`;
}

function updateExecuteButton() {
  const hasQty = products.some(p => p.newQty && !p.completed);
  const hasDates = dateStart.value.length === 5 && dateEnd.value.length === 5;
  executeBtn.disabled = !hasQty && !hasDates;
}

// Send to frame
async function sendToFrame(message) {
  if (productsFrameId !== null) {
    try {
      return await chrome.tabs.sendMessage(currentTabId, message, { frameId: productsFrameId });
    } catch (e) {}
  }
  
  const frames = await chrome.webNavigation.getAllFrames({ tabId: currentTabId });
  for (const frame of frames) {
    try {
      const response = await chrome.tabs.sendMessage(currentTabId, message, { frameId: frame.frameId });
      if (response?.success) return response;
    } catch (e) {}
  }
  return { success: false, error: 'Comunicação falhou' };
}

// Execute automation
async function executeAutomation() {
  if (!isConnected) return;
  
  executeBtn.disabled = true;
  progressContainer.style.display = 'block';
  progressFill.style.width = '0%';
  
  const productsToEdit = products.filter(p => p.newQty && !p.completed);
  const hasDateChange = dateStart.value.length === 5 && dateEnd.value.length === 5;
  const totalSteps = productsToEdit.length + (hasDateChange ? 1 : 0) + 1; // +1 for total
  let currentStep = 0;
  let allProductsDone = productsToEdit.length === 0;
  
  try {
    // Edit products one by one
    for (const product of productsToEdit) {
      progressText.textContent = `${product.description}: Abra o painel e clique Executar`;
      
      const result = await sendToFrame({
        action: 'editProduct',
        productCode: product.code,
        newQty: product.newQty
      });
      
      if (result?.success) {
        product.completed = true;
        currentStep++;
        progressFill.style.width = `${(currentStep / totalSteps) * 100}%`;
        progressText.textContent = `${product.description}: Salvo!`;
        await saveState();
        renderProducts();
        await new Promise(r => setTimeout(r, 1500));
      } else {
        progressText.textContent = result?.error || 'Abra o painel do produto';
        executeBtn.disabled = false;
        await saveState();
        return;
      }
    }
    
    allProductsDone = true;
    
    // Update date (go to Observação tab first)
    if (hasDateChange) {
      progressText.textContent = 'Vá para aba Observação...';
      await new Promise(r => setTimeout(r, 500));
      
      // Try to click Observação tab
      await sendToFrame({ action: 'clickTab', tabName: 'Observação' });
      await new Promise(r => setTimeout(r, 1000));
      
      progressText.textContent = 'Atualizando data...';
      const dateText = `De ${dateStart.value} a ${dateEnd.value}`;
      
      const dateResult = await sendToFrame({
        action: 'updateDate',
        dateText: dateText
      });
      
      currentStep++;
      progressFill.style.width = `${(currentStep / totalSteps) * 100}%`;
      
      if (dateResult?.success) {
        progressText.textContent = 'Data atualizada!';
      } else {
        progressText.textContent = 'Atualize a data manualmente na aba Observação';
      }
      
      await new Promise(r => setTimeout(r, 1000));
    }
    
    // Go to Total tab and get value
    progressText.textContent = 'Obtendo total...';
    await sendToFrame({ action: 'clickTab', tabName: 'Total' });
    await new Promise(r => setTimeout(r, 1000));
    
    const totalResult = await sendToFrame({ action: 'getTotalValue' });
    currentStep++;
    progressFill.style.width = `${(currentStep / totalSteps) * 100}%`;
    
    // Go to Pagamento tab (final step)
    progressText.textContent = 'Abrindo aba Pagamento...';
    await sendToFrame({ action: 'clickTab', tabName: 'Pagamento' });
    await new Promise(r => setTimeout(r, 500));
    
    progressFill.style.width = '100%';
    progressText.textContent = 'Concluído!';
    
    // Show result
    setTimeout(() => {
      resultSection.style.display = 'block';
      totalValue.textContent = `R$ ${totalResult?.totalValue || '0,00'}`;
      progressContainer.style.display = 'none';
    }, 500);
    
  } catch (error) {
    progressText.textContent = `Erro: ${error.message}`;
  }
  
  executeBtn.disabled = false;
  await saveState();
}

// Copy total
async function copyTotal() {
  const value = totalValue.textContent;
  await navigator.clipboard.writeText(value);
  copyTotalBtn.textContent = 'Copiado!';
  setTimeout(() => { copyTotalBtn.textContent = 'Copiar'; }, 1500);
}

// Event listeners
function setupEventListeners() {
  refreshProducts.addEventListener('click', loadProducts);
  dateStart.addEventListener('input', () => formatDateInput(dateStart));
  dateEnd.addEventListener('input', () => formatDateInput(dateEnd));
  executeBtn.addEventListener('click', executeAutomation);
  clearBtn.addEventListener('click', clearState);
  copyTotalBtn.addEventListener('click', copyTotal);
}
