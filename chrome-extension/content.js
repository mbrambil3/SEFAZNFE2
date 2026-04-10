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
    
    // Find all table rows
    const rows = document.querySelectorAll('tr');
    console.log('SEFAZ Editor - Found rows:', rows.length);
    
    rows.forEach((row, rowIndex) => {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 4) {
        // Look for a row that has a checkbox and a 4-digit code
        const checkbox = row.querySelector('input[type="checkbox"]');
        const cellTexts = Array.from(cells).map(c => c.textContent.trim());
        const rowText = cellTexts.join('|');
        
        // Find 4-digit code (like 0001, 0002)
        let code = null;
        let description = null;
        let qty = null;
        let unitValue = null;
        let totalValue = null;
        
        for (let i = 0; i < cellTexts.length; i++) {
          const text = cellTexts[i];
          
          // Code: exactly 4 digits
          if (!code && text.match(/^\d{4}$/)) {
            code = text;
          }
          // Description: text with letters (check for link too)
          else if (!description && code) {
            const link = cells[i]?.querySelector('a');
            if (link) {
              description = link.textContent.trim();
            } else if (text.match(/^[A-ZÀ-Úa-zà-ú\s\-\.]+$/) && text.length > 1) {
              description = text;
            }
          }
          // Quantity: number with comma and 4 decimals (like 88,0000)
          else if (!qty && text.match(/^\d+,\d{4}$/)) {
            qty = text;
          }
          // Unit value: number with 2-4 decimals
          else if (qty && !unitValue && text.match(/^\d+,\d{2,4}$/)) {
            unitValue = text;
          }
          // Total value: number with thousands separator
          else if (!totalValue && text.match(/^[\d\.]+,\d{2}$/)) {
            totalValue = text;
          }
        }
        
        // If we found a valid product row
        if (code && description && checkbox) {
          products.push({
            index: products.length,
            rowIndex: rowIndex,
            code: code,
            description: description,
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
    console.log('SEFAZ Editor - editProduct called with code:', productCode, 'index:', productIndex, 'qty:', newQty);
    
    // Step 1: Find the product row by code
    let targetRow = null;
    let targetCheckbox = null;
    
    const rows = document.querySelectorAll('tr');
    
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      const rowText = row.textContent;
      
      // Check if this row contains the product code
      if (rowText.includes(productCode)) {
        const checkbox = row.querySelector('input[type="checkbox"]');
        if (checkbox) {
          targetRow = row;
          targetCheckbox = checkbox;
          console.log('SEFAZ Editor - Found product row for code:', productCode);
          break;
        }
      }
    }
    
    if (!targetRow || !targetCheckbox) {
      throw new Error(`Produto ${productCode} não encontrado na tabela`);
    }
    
    // Step 2: Uncheck ALL checkboxes first
    const allCheckboxes = document.querySelectorAll('input[type="checkbox"]');
    allCheckboxes.forEach(cb => {
      if (cb.checked) {
        cb.checked = false;
        cb.click();
      }
    });
    await sleep(300);
    
    // Step 3: Check ONLY the target product checkbox
    if (!targetCheckbox.checked) {
      targetCheckbox.click();
    }
    console.log('SEFAZ Editor - Checkbox selected for:', productCode);
    await sleep(500);
    
    // Step 4: Click the "Editar" button
    const editBtn = findButton('Editar');
    if (!editBtn) {
      throw new Error('Botão Editar não encontrado');
    }
    
    console.log('SEFAZ Editor - Clicking Editar button');
    editBtn.click();
    
    // Step 5: Wait for edit panel to open
    await sleep(2000);
    
    // Step 6: Find the Qtd. Comercial input field
    let qtyInput = null;
    
    // Look for input near "Qtd. Comercial" or "Qtd Comercial" text
    const allElements = document.querySelectorAll('td, span, label, div');
    for (const el of allElements) {
      const text = el.textContent.trim();
      if (text.includes('Qtd. Comercial') || text.includes('Qtd Comercial') || text === '*Qtd. Comercial:') {
        // Find the input in the same row or nearby
        const parent = el.closest('tr') || el.parentElement?.parentElement;
        if (parent) {
          const inputs = parent.querySelectorAll('input[type="text"], input:not([type="checkbox"]):not([type="hidden"]):not([type="button"]):not([type="submit"])');
          for (const inp of inputs) {
            // The qty field typically has a value like "88,0000"
            if (inp.value && inp.value.match(/^\d+,\d{4}$/)) {
              qtyInput = inp;
              break;
            }
            // Or it's the first editable input after the label
            if (!inp.readOnly && !inp.disabled) {
              qtyInput = inp;
              break;
            }
          }
        }
        if (qtyInput) break;
      }
    }
    
    // Fallback: find input with qty pattern
    if (!qtyInput) {
      const allInputs = document.querySelectorAll('input[type="text"], input:not([type])');
      for (const inp of allInputs) {
        if (inp.value && inp.value.match(/^\d+,\d{4}$/) && !inp.readOnly) {
          qtyInput = inp;
          console.log('SEFAZ Editor - Found qty input by pattern:', inp.value);
          break;
        }
      }
    }
    
    if (!qtyInput) {
      throw new Error('Campo Qtd. Comercial não encontrado');
    }
    
    console.log('SEFAZ Editor - Found qty input, current value:', qtyInput.value);
    
    // Step 7: Update the quantity field
    qtyInput.focus();
    qtyInput.select();
    
    // Format the new quantity with 4 decimal places
    let formattedQty = newQty.replace('.', ',');
    if (!formattedQty.includes(',')) {
      formattedQty = formattedQty + ',0000';
    } else {
      const parts = formattedQty.split(',');
      formattedQty = parts[0] + ',' + (parts[1] || '').padEnd(4, '0').substring(0, 4);
    }
    
    qtyInput.value = formattedQty;
    qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
    qtyInput.dispatchEvent(new Event('change', { bubbles: true }));
    qtyInput.dispatchEvent(new Event('blur', { bubbles: true }));
    
    console.log('SEFAZ Editor - Set quantity to:', formattedQty);
    await sleep(500);
    
    // Step 8: Click "Salvar Item" button
    const saveBtn = findButton('Salvar Item') || findButton('Salvar');
    if (!saveBtn) {
      throw new Error('Botão Salvar Item não encontrado');
    }
    
    console.log('SEFAZ Editor - Clicking Salvar Item button');
    saveBtn.click();
    
    // Step 9: Wait for save to complete
    await sleep(2000);
    
    // Step 10: Uncheck the checkbox
    if (targetCheckbox.checked) {
      targetCheckbox.click();
    }
    
    console.log('SEFAZ Editor - Product', productCode, 'edited successfully');
    return { success: true };
    
  } catch (error) {
    console.error('SEFAZ Editor - Error editing product:', error);
    return { success: false, error: error.message };
  }
}

// Get total value
async function getTotalValue() {
  try {
    let totalValue = 0;
    
    const rows = document.querySelectorAll('tr');
    
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 8) {
        const cellTexts = Array.from(cells).map(c => c.textContent.trim());
        
        // Look for V. Total values (format: 2.024,00 or 237,60)
        for (const text of cellTexts) {
          if (text.match(/^[\d\.]+,\d{2}$/)) {
            const value = parseValue(text);
            if (value > 0) {
              totalValue += value;
            }
          }
        }
      }
    }
    
    // Divide by 2 because we might be counting each value twice
    // (once in the list, once somewhere else)
    // Actually, let's be more precise and only count unique rows
    totalValue = 0;
    const processedCodes = new Set();
    
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      const cellTexts = Array.from(cells).map(c => c.textContent.trim());
      const rowText = cellTexts.join('|');
      
      // Find code to identify unique products
      const codeMatch = rowText.match(/\|(\d{4})\|/);
      if (codeMatch && !processedCodes.has(codeMatch[1])) {
        processedCodes.add(codeMatch[1]);
        
        // Find total value in this row (last number with format X.XXX,XX or XXX,XX)
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

// Helper: Find button by text
function findButton(text) {
  // Check input buttons
  const inputs = document.querySelectorAll('input[type="button"], input[type="submit"]');
  for (const inp of inputs) {
    if (inp.value && inp.value.includes(text)) {
      console.log('SEFAZ Editor - Found button:', inp.value);
      return inp;
    }
  }
  
  // Check regular buttons
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) {
    if (btn.textContent && btn.textContent.includes(text)) {
      return btn;
    }
  }
  
  // Check links
  const links = document.querySelectorAll('a');
  for (const link of links) {
    if (link.textContent && link.textContent.includes(text)) {
      return link;
    }
  }
  
  // Check images with alt/title
  const imgs = document.querySelectorAll('img');
  for (const img of imgs) {
    if ((img.alt && img.alt.includes(text)) || (img.title && img.title.includes(text))) {
      const parent = img.closest('a, button, [onclick], td');
      return parent || img;
    }
  }
  
  // Check elements with onclick
  const clickables = document.querySelectorAll('[onclick]');
  for (const el of clickables) {
    if (el.textContent && el.textContent.trim().includes(text)) {
      return el;
    }
  }
  
  return null;
}

// Helper: Sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper: Parse Brazilian currency value
function parseValue(str) {
  if (!str) return 0;
  const cleaned = str.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
  return parseFloat(cleaned) || 0;
}

// Helper: Format as Brazilian currency
function formatCurrency(value) {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
