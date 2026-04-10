// DOM Elements
const statusBadge = document.getElementById('statusBadge');
const warningBox = document.getElementById('warningBox');
const mainContent = document.getElementById('mainContent');
const productsLoading = document.getElementById('productsLoading');
const productsEmpty = document.getElementById('productsEmpty');
const productsList = document.getElementById('productsList');
const refreshProducts = document.getElementById('refreshProducts');
const executeBtn = document.getElementById('executeBtn');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const resultSection = document.getElementById('resultSection');
const totalValue = document.getElementById('totalValue');
const copyTotalBtn = document.getElementById('copyTotalBtn');

// State
let products = [];
let isConnected = false;
let currentTabId = null;
let productsFrameId = null; // Store the frame ID where products were found

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await checkConnection();
  setupEventListeners();
});

// Check if we're on the correct page
async function checkConnection() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab.id;
    
    const isCorrectSite = tab.url && tab.url.includes('nfe-extranet.sefazrs.rs.gov.br');
    
    if (isCorrectSite) {
      setConnected(true);
      await loadProducts();
    } else {
      setConnected(false);
    }
  } catch (error) {
    console.error('Error checking connection:', error);
    setConnected(false);
  }
}

// Update connection status UI
function setConnected(connected) {
  isConnected = connected;
  const statusText = statusBadge.querySelector('.status-text');
  
  if (connected) {
    statusBadge.classList.add('connected');
    statusBadge.classList.remove('disconnected');
    statusText.textContent = 'Conectado';
    warningBox.style.display = 'none';
    mainContent.style.display = 'flex';
  } else {
    statusBadge.classList.add('disconnected');
    statusBadge.classList.remove('connected');
    statusText.textContent = 'Desconectado';
    warningBox.style.display = 'flex';
    mainContent.style.opacity = '0.5';
    mainContent.style.pointerEvents = 'none';
  }
}

// Load products from the page (handles iframes)
async function loadProducts() {
  productsLoading.style.display = 'flex';
  productsEmpty.style.display = 'none';
  productsList.style.display = 'none';
  productsFrameId = null;
  
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId: currentTabId });
    let allProducts = [];
    
    console.log('Searching for products in', frames?.length || 0, 'frames');
    
    if (frames && frames.length > 0) {
      for (const frame of frames) {
        try {
          console.log('Checking frame:', frame.frameId, frame.url);
          const response = await chrome.tabs.sendMessage(currentTabId, { action: 'getProducts' }, { frameId: frame.frameId });
          console.log('Frame', frame.frameId, 'response:', response?.products?.length || 0, 'products');
          
          if (response && response.products && response.products.length > 0) {
            allProducts = response.products;
            productsFrameId = frame.frameId; // Save the frame ID where products were found!
            console.log('Products found in frame:', productsFrameId);
            break; // Stop searching once we find products
          }
        } catch (e) {
          console.log('Frame', frame.frameId, 'error:', e.message);
        }
      }
    }
    
    if (allProducts.length > 0) {
      const seen = new Set();
      products = allProducts.filter(p => {
        if (seen.has(p.code)) return false;
        seen.add(p.code);
        return true;
      });
      products.forEach((p, i) => p.index = i);
      
      renderProducts();
      productsLoading.style.display = 'none';
      productsList.style.display = 'flex';
    } else {
      productsLoading.style.display = 'none';
      productsEmpty.style.display = 'flex';
    }
  } catch (error) {
    console.error('Error loading products:', error);
    productsLoading.style.display = 'none';
    productsEmpty.style.display = 'flex';
  }
}

// Render products list
function renderProducts() {
  productsList.innerHTML = '';
  
  products.forEach((product, index) => {
    const item = document.createElement('div');
    item.className = 'product-item';
    
    item.innerHTML = `
      <div class="product-info">
        <div class="product-name" title="${product.description}">${product.description}</div>
        <div class="product-details">Cód: ${product.code} | V.U: ${product.unitValue || '-'}</div>
      </div>
      <input 
        type="text" 
        class="product-qty-input" 
        data-index="${index}"
        placeholder="Qtd"
        value="${product.newQty || ''}"
        data-testid="product-qty-input-${index}"
      >
    `;
    
    productsList.appendChild(item);
  });
  
  document.querySelectorAll('.product-qty-input').forEach(input => {
    input.addEventListener('input', handleQtyInput);
  });
  
  updateExecuteButton();
}

// Handle quantity input
function handleQtyInput(e) {
  const index = parseInt(e.target.dataset.index);
  const value = e.target.value.replace(/[^\d,\.]/g, '');
  e.target.value = value;
  products[index].newQty = value;
  updateExecuteButton();
}

// Update execute button state
function updateExecuteButton() {
  const hasQuantities = products.some(p => p.newQty && p.newQty.length > 0);
  executeBtn.disabled = !hasQuantities;
}

// Send message to the products frame specifically
async function sendToProductsFrame(message) {
  if (productsFrameId !== null) {
    console.log('Sending to products frame:', productsFrameId, message.action);
    return await chrome.tabs.sendMessage(currentTabId, message, { frameId: productsFrameId });
  } else {
    // Fallback: try all frames
    const frames = await chrome.webNavigation.getAllFrames({ tabId: currentTabId });
    for (const frame of frames) {
      try {
        const response = await chrome.tabs.sendMessage(currentTabId, message, { frameId: frame.frameId });
        if (response && response.success) {
          return response;
        }
      } catch (e) {
        // Continue
      }
    }
    throw new Error('Não foi possível comunicar com a página');
  }
}

// Execute the automation (only product editing)
async function executeAutomation() {
  if (!isConnected) return;
  
  executeBtn.disabled = true;
  progressContainer.style.display = 'block';
  progressFill.style.width = '0%';
  progressText.textContent = 'Iniciando...';
  
  const productsToEdit = products.filter(p => p.newQty && p.newQty.length > 0);
  const totalSteps = productsToEdit.length;
  let currentStep = 0;
  let hasError = false;
  
  try {
    // Edit each product
    for (const product of productsToEdit) {
      progressText.textContent = `Editando: ${product.description}...`;
      console.log('Editing product:', product.code, product.description, 'new qty:', product.newQty);
      
      const result = await sendToProductsFrame({
        action: 'editProduct',
        productCode: product.code, // Send code instead of index for more reliable matching
        productIndex: product.index,
        newQty: product.newQty
      });
      
      console.log('Edit result:', result);
      
      if (!result || !result.success) {
        progressText.textContent = `Erro: ${result?.error || 'Falha ao editar produto'}`;
        hasError = true;
        break;
      }
      
      currentStep++;
      progressFill.style.width = `${(currentStep / totalSteps) * 100}%`;
      
      // Delay between products
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    
    if (!hasError) {
      // Get total value
      progressText.textContent = 'Calculando valor total...';
      const response = await sendToProductsFrame({ action: 'getTotalValue' });
      
      progressFill.style.width = '100%';
      progressText.textContent = 'Concluído!';
      
      setTimeout(() => {
        resultSection.style.display = 'block';
        totalValue.textContent = `R$ ${response?.totalValue || '0,00'}`;
        progressContainer.style.display = 'none';
      }, 500);
    }
    
    executeBtn.disabled = false;
    
  } catch (error) {
    console.error('Error during automation:', error);
    progressText.textContent = `Erro: ${error.message}`;
    progressFill.style.background = 'var(--accent-error)';
    executeBtn.disabled = false;
  }
}

// Copy total value to clipboard
async function copyTotal() {
  const value = totalValue.textContent;
  
  try {
    await navigator.clipboard.writeText(value);
    copyTotalBtn.classList.add('copied');
    copyTotalBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M5 13L9 17L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Copiado!
    `;
    
    setTimeout(() => {
      copyTotalBtn.classList.remove('copied');
      copyTotalBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 5H6C4.89543 5 4 5.89543 4 7V19C4 20.1046 4.89543 21 6 21H16C17.1046 21 18 20.1046 18 19V18M8 5C8 6.10457 8.89543 7 10 7H12C13.1046 7 14 6.10457 14 5M8 5C8 3.89543 8.89543 3 10 3H12C13.1046 3 14 3.89543 14 5M14 5H16C17.1046 5 18 5.89543 18 7V10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Copiar Valor
      `;
    }, 2000);
  } catch (error) {
    console.error('Failed to copy:', error);
  }
}

// Setup event listeners
function setupEventListeners() {
  refreshProducts.addEventListener('click', loadProducts);
  executeBtn.addEventListener('click', executeAutomation);
  copyTotalBtn.addEventListener('click', copyTotal);
}
