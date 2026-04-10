// Content script for SEFAZ NF-e Editor
// This script runs in the context of the SEFAZ website (including iframes)

console.log('SEFAZ NF-e Editor - Content script loaded in:', window.location.href);

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('SEFAZ Editor - Message received:', request.action);
  
  switch (request.action) {
    case 'getProducts':
      getProducts().then(sendResponse);
      return true;
      
    case 'editProduct':
      editProduct(request.productCode, request.productIndex, request.newQty).then(sendResponse);
      return true;
      
    case 'getTotalValue':
      getTotalValue().then(sendResponse);
      return true;
  }
});

// Get products from the table
async function getProducts() {
  try {
    console.log('SEFAZ Editor - Searching for products...');
    const products = [];
    
    const rows = document.querySelectorAll('tr');
    console.log('SEFAZ Editor - Found rows:', rows.length);
    
    rows.forEach((row, rowIndex) => {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 4) {
        const checkbox = row.querySelector('input[type="checkbox"]');
        const cellTexts = Array.from(cells).map(c => c.textContent.trim());
        
        let code = null;
        let description = null;
        let descriptionLink = null;
        let qty = null;
        let unitValue = null;
        let totalValue = null;
        
        for (let i = 0; i < cells.length; i++) {
          const text = cellTexts[i];
          const cell = cells[i];
          
          if (!code && text.match(/^\d{4}$/)) {
            code = text;
          } else if (!description && code) {
            const link = cell.querySelector('a');
            if (link) {
              description = link.textContent.trim();
              descriptionLink = link;
            } else if (text.match(/^[A-ZÀ-Úa-zà-ú\s\-\.]+$/) && text.length > 1) {
              description = text;
            }
          } else if (!qty && text.match(/^\d+,\d{4}$/)) {
            qty = text;
          } else if (qty && !unitValue && text.match(/^\d+,\d{2,4}$/)) {
            unitValue = text;
          } else if (!totalValue && text.match(/^[\d\.]+,\d{2}$/)) {
            totalValue = text;
          }
        }
        
        if (code && description && checkbox) {
          products.push({
            index: products.length,
            rowIndex: rowIndex,
            code: code,
            description: description,
            hasLink: !!descriptionLink,
            currentQty: qty || '',
            unitValue: unitValue || '',
            totalValue: totalValue || '',
            newQty: ''
          });
          console.log('SEFAZ Editor - Found product:', code, description);
        }
      }
    });
    
    console.log('SEFAZ Editor - Total products found:', products.length);
    return { success: true, products };
    
  } catch (error) {
    console.error('SEFAZ Editor - Error getting products:', error);
    return { success: false, error: error.message, products: [] };
  }
}

// Edit a product's quantity
async function editProduct(productCode, productIndex, newQty) {
  try {
    console.log('SEFAZ Editor - editProduct called with code:', productCode, 'qty:', newQty);
    
    // First, check if we're already in the edit panel
    let qtyInput = findQtdComercialInput();
    if (qtyInput) {
      console.log('SEFAZ Editor - Already in edit panel, filling quantity');
      return await fillQuantityAndSave(qtyInput, newQty, productCode);
    }
    
    // Find the product row and link
    let targetRow = null;
    let productLink = null;
    
    const rows = document.querySelectorAll('tr');
    
    for (const row of rows) {
      const rowText = row.textContent;
      if (rowText.includes(productCode)) {
        const checkbox = row.querySelector('input[type="checkbox"]');
        const links = row.querySelectorAll('a');
        
        for (const link of links) {
          const linkText = link.textContent.trim();
          if (linkText && linkText.length > 1 && linkText.match(/^[A-ZÀ-Úa-zà-ú\s\-\.]+$/)) {
            productLink = link;
            break;
          }
        }
        
        if (checkbox) {
          targetRow = row;
          break;
        }
      }
    }
    
    if (!targetRow) {
      throw new Error(`Produto ${productCode} não encontrado`);
    }
    
    // Try clicking the product link
    if (productLink) {
      console.log('SEFAZ Editor - Clicking product link:', productLink.textContent);
      
      // Get the href or onclick
      const href = productLink.getAttribute('href') || '';
      const onclick = productLink.getAttribute('onclick') || '';
      
      console.log('SEFAZ Editor - Link href:', href);
      console.log('SEFAZ Editor - Link onclick:', onclick);
      
      // Try to execute the link's action directly
      if (href.startsWith('javascript:')) {
        try {
          const jsCode = href.replace('javascript:', '');
          console.log('SEFAZ Editor - Executing javascript:', jsCode.substring(0, 50));
          eval(jsCode);
        } catch (e) {
          console.log('SEFAZ Editor - JS eval failed:', e.message);
        }
      } else {
        productLink.click();
      }
      
      // Wait for panel to load
      await sleep(3000);
      
      // Try to find the qty input
      qtyInput = findQtdComercialInput();
      if (qtyInput) {
        return await fillQuantityAndSave(qtyInput, newQty, productCode);
      }
    }
    
    throw new Error('Por favor, abra o painel de edição clicando no produto e execute novamente.');
    
  } catch (error) {
    console.error('SEFAZ Editor - Error:', error);
    return { success: false, error: error.message };
  }
}

// Find the specific Qtd. Comercial input field
function findQtdComercialInput() {
  console.log('SEFAZ Editor - Looking for Qtd. Comercial field...');
  
  // Strategy 1: Find TD that contains exactly "*Qtd. Comercial:" and get the input in the NEXT TD
  const allTds = document.querySelectorAll('td');
  
  for (const td of allTds) {
    const text = td.textContent.trim();
    
    // Check for exact label match
    if (text === '*Qtd. Comercial:' || text === 'Qtd. Comercial:' || text === '*Qtd Comercial:') {
      console.log('SEFAZ Editor - Found label TD:', text);
      
      // The input should be in the NEXT sibling TD
      let nextTd = td.nextElementSibling;
      if (nextTd && nextTd.tagName === 'TD') {
        const input = nextTd.querySelector('input[type="text"], input:not([type])');
        if (input && !input.readOnly && !input.disabled) {
          console.log('SEFAZ Editor - Found Qtd input in next TD, value:', input.value);
          return input;
        }
      }
      
      // Also check the same row
      const row = td.closest('tr');
      if (row) {
        const tdsInRow = row.querySelectorAll('td');
        let foundLabel = false;
        for (const rowTd of tdsInRow) {
          if (rowTd.textContent.trim().includes('Qtd. Comercial')) {
            foundLabel = true;
            continue;
          }
          if (foundLabel) {
            const input = rowTd.querySelector('input[type="text"], input:not([type])');
            if (input && !input.readOnly && !input.disabled) {
              console.log('SEFAZ Editor - Found Qtd input in row, value:', input.value);
              return input;
            }
          }
        }
      }
    }
  }
  
  // Strategy 2: Find all inputs and identify by position relative to label
  const pageHTML = document.body.innerHTML;
  
  // Look for the pattern: *Qtd. Comercial: followed by an input
  const qtdLabelRegex = /\*?Qtd\.?\s*Comercial:?\s*<\/td>\s*<td[^>]*>\s*<input[^>]*name="([^"]+)"/i;
  const match = pageHTML.match(qtdLabelRegex);
  
  if (match && match[1]) {
    const input = document.querySelector(`input[name="${match[1]}"]`);
    if (input) {
      console.log('SEFAZ Editor - Found Qtd input by name pattern:', match[1], 'value:', input.value);
      return input;
    }
  }
  
  // Strategy 3: Look at ALL inputs and find the one with 4 decimal places that's AFTER "Valor Unit" section
  const allInputs = document.querySelectorAll('input[type="text"], input:not([type="checkbox"]):not([type="hidden"]):not([type="button"])');
  let foundValorUnit = false;
  
  for (const input of allInputs) {
    // Check the label/TD before this input
    const parentTd = input.closest('td');
    if (parentTd) {
      const prevTd = parentTd.previousElementSibling;
      if (prevTd) {
        const prevText = prevTd.textContent.trim();
        
        if (prevText.includes('Valor Unit. Comercial') || prevText.includes('Valor Unit Comercial')) {
          foundValorUnit = true;
          console.log('SEFAZ Editor - Found Valor Unit input, skipping...');
          continue;
        }
        
        if ((prevText.includes('Qtd. Comercial') || prevText.includes('Qtd Comercial')) && !prevText.includes('Valor')) {
          console.log('SEFAZ Editor - Found Qtd. Comercial input via label check, value:', input.value);
          return input;
        }
      }
    }
    
    // After finding Valor Unit, the next input with similar format should be Qtd
    if (foundValorUnit && input.value && input.value.match(/^\d+,\d{4}$/)) {
      console.log('SEFAZ Editor - Found Qtd input after Valor Unit, value:', input.value);
      return input;
    }
  }
  
  console.log('SEFAZ Editor - Qtd. Comercial input NOT FOUND');
  return null;
}

// Fill quantity and save
async function fillQuantityAndSave(qtyInput, newQty, productCode) {
  try {
    console.log('SEFAZ Editor - Filling quantity:', newQty, 'in field with current value:', qtyInput.value);
    
    // Focus and select the input
    qtyInput.focus();
    await sleep(200);
    qtyInput.select();
    await sleep(100);
    
    // Format quantity with 4 decimal places
    let formattedQty = newQty.replace('.', ',');
    if (!formattedQty.includes(',')) {
      formattedQty = formattedQty + ',0000';
    } else {
      const parts = formattedQty.split(',');
      formattedQty = parts[0] + ',' + (parts[1] || '').padEnd(4, '0').substring(0, 4);
    }
    
    // Clear and set new value
    qtyInput.value = '';
    await sleep(50);
    qtyInput.value = formattedQty;
    
    // Trigger events
    qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
    qtyInput.dispatchEvent(new Event('change', { bubbles: true }));
    qtyInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    qtyInput.dispatchEvent(new Event('blur', { bubbles: true }));
    
    console.log('SEFAZ Editor - Quantity set to:', formattedQty);
    await sleep(500);
    
    // Find and click Salvar Item
    const saveBtn = findButton('Salvar Item');
    if (!saveBtn) {
      throw new Error('Botão Salvar Item não encontrado');
    }
    
    console.log('SEFAZ Editor - Clicking Salvar Item');
    saveBtn.click();
    await sleep(2500);
    
    console.log('SEFAZ Editor - Product', productCode, 'saved successfully!');
    return { success: true };
    
  } catch (error) {
    console.error('SEFAZ Editor - Error saving:', error);
    return { success: false, error: error.message };
  }
}

// Get total value
async function getTotalValue() {
  try {
    let totalValue = 0;
    const processedCodes = new Set();
    const rows = document.querySelectorAll('tr');
    
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      const cellTexts = Array.from(cells).map(c => c.textContent.trim());
      const rowText = cellTexts.join('|');
      
      const codeMatch = rowText.match(/\|(\d{4})\|/);
      if (codeMatch && !processedCodes.has(codeMatch[1])) {
        processedCodes.add(codeMatch[1]);
        
        for (let i = cellTexts.length - 1; i >= 0; i--) {
          if (cellTexts[i].match(/^[\d\.]+,\d{2}$/)) {
            totalValue += parseValue(cellTexts[i]);
            break;
          }
        }
      }
    }
    
    const formattedTotal = formatCurrency(totalValue);
    console.log('SEFAZ Editor - Total value:', formattedTotal);
    return { success: true, totalValue: formattedTotal };
    
  } catch (error) {
    console.error('SEFAZ Editor - Error getting total:', error);
    return { success: false, error: error.message, totalValue: '0,00' };
  }
}

// Find button by text
function findButton(text) {
  const inputs = document.querySelectorAll('input[type="button"], input[type="submit"], input[type="image"]');
  for (const inp of inputs) {
    const value = inp.value || inp.alt || inp.title || '';
    if (value.includes(text)) {
      return inp;
    }
  }
  
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) {
    if (btn.textContent && btn.textContent.includes(text)) {
      return btn;
    }
  }
  
  const links = document.querySelectorAll('a');
  for (const link of links) {
    if (link.textContent && link.textContent.includes(text)) {
      return link;
    }
  }
  
  const imgs = document.querySelectorAll('img');
  for (const img of imgs) {
    if ((img.alt && img.alt.includes(text)) || (img.title && img.title.includes(text))) {
      const parent = img.closest('a, button, [onclick], td');
      return parent || img;
    }
  }
  
  return null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseValue(str) {
  if (!str) return 0;
  const cleaned = str.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
  return parseFloat(cleaned) || 0;
}

function formatCurrency(value) {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
