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
              descriptionLink = link; // Save the link element!
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
          console.log('SEFAZ Editor - Found product:', code, description, 'hasLink:', !!descriptionLink);
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
    
    // Step 1: Find the product row and its link by code
    let targetRow = null;
    let targetCheckbox = null;
    let productLink = null;
    
    const rows = document.querySelectorAll('tr');
    
    for (const row of rows) {
      const rowText = row.textContent;
      if (rowText.includes(productCode)) {
        const checkbox = row.querySelector('input[type="checkbox"]');
        const links = row.querySelectorAll('a');
        
        // Find the product name link
        for (const link of links) {
          const linkText = link.textContent.trim();
          if (linkText && linkText.length > 1 && linkText.match(/^[A-ZÀ-Úa-zà-ú\s\-\.]+$/)) {
            productLink = link;
            break;
          }
        }
        
        if (checkbox) {
          targetRow = row;
          targetCheckbox = checkbox;
          console.log('SEFAZ Editor - Found product row for code:', productCode);
          console.log('SEFAZ Editor - Product link found:', !!productLink, productLink?.textContent);
          break;
        }
      }
    }
    
    if (!targetRow) {
      throw new Error(`Produto ${productCode} não encontrado na tabela`);
    }
    
    // Step 2: Try to open edit panel by clicking on the product name LINK
    if (productLink) {
      console.log('SEFAZ Editor - Clicking on product link:', productLink.textContent);
      
      // Try clicking the link directly
      productLink.click();
      await sleep(2000);
      
      // Check if panel opened
      let panelOpened = await waitForEditPanel(5000);
      
      if (panelOpened) {
        console.log('SEFAZ Editor - Panel opened via link click!');
        return await fillAndSave(newQty, productCode);
      }
    }
    
    // Step 3: Alternative - Try double-clicking on the row
    console.log('SEFAZ Editor - Trying double-click on row');
    const dblClickEvent = new MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true,
      view: window
    });
    targetRow.dispatchEvent(dblClickEvent);
    await sleep(2000);
    
    let panelOpened = await waitForEditPanel(5000);
    if (panelOpened) {
      console.log('SEFAZ Editor - Panel opened via double-click!');
      return await fillAndSave(newQty, productCode);
    }
    
    // Step 4: Try the checkbox + Editar button approach
    console.log('SEFAZ Editor - Trying checkbox + Editar button approach');
    
    // Uncheck all checkboxes
    const allCheckboxes = document.querySelectorAll('input[type="checkbox"]');
    for (const cb of allCheckboxes) {
      if (cb.checked) {
        cb.checked = false;
        cb.click();
        await sleep(50);
      }
    }
    await sleep(300);
    
    // Check target checkbox
    targetCheckbox.checked = true;
    targetCheckbox.click();
    await sleep(500);
    
    // Find Editar button
    const editBtn = findButton('Editar');
    if (editBtn) {
      console.log('SEFAZ Editor - Found Editar button, checking onclick...');
      
      // Check if it has an onclick with __doPostBack
      const onclickAttr = editBtn.getAttribute('onclick') || '';
      console.log('SEFAZ Editor - Editar onclick:', onclickAttr);
      
      // If it uses __doPostBack, try to call it directly
      if (onclickAttr.includes('__doPostBack')) {
        const match = onclickAttr.match(/__doPostBack\('([^']+)','([^']*)'\)/);
        if (match && window.__doPostBack) {
          console.log('SEFAZ Editor - Calling __doPostBack directly:', match[1], match[2]);
          window.__doPostBack(match[1], match[2]);
          await sleep(2000);
          
          panelOpened = await waitForEditPanel(5000);
          if (panelOpened) {
            console.log('SEFAZ Editor - Panel opened via __doPostBack!');
            return await fillAndSave(newQty, productCode);
          }
        }
      }
      
      // Try regular click
      editBtn.click();
      await sleep(2000);
      
      panelOpened = await waitForEditPanel(5000);
      if (panelOpened) {
        console.log('SEFAZ Editor - Panel opened via Editar button!');
        return await fillAndSave(newQty, productCode);
      }
    }
    
    // Step 5: Try clicking any element in the row that might be clickable
    console.log('SEFAZ Editor - Trying to find any clickable element in the row');
    const clickableElements = targetRow.querySelectorAll('[onclick], a[href*="javascript"], a:not([href=""])');
    for (const el of clickableElements) {
      console.log('SEFAZ Editor - Found clickable:', el.tagName, el.textContent?.substring(0, 20));
    }
    
    throw new Error('Não foi possível abrir o painel de edição. Tente clicar manualmente no nome do produto.');
    
  } catch (error) {
    console.error('SEFAZ Editor - Error editing product:', error);
    return { success: false, error: error.message };
  }
}

// Wait for edit panel to open
async function waitForEditPanel(timeout) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    // Look for signs that the edit panel is open
    const salvarBtn = findButton('Salvar Item');
    const qtdLabel = document.body.innerHTML.includes('Qtd. Comercial');
    const codigoField = document.querySelector('input[value="' + '0001' + '"], input[value="' + '0002' + '"]');
    
    // Also check for the panel title "Produtos e Serviços" in a modal context
    const modalTitle = document.body.innerHTML.includes('Produtos e Serviços') && 
                       document.body.innerHTML.includes('Dados') && 
                       document.body.innerHTML.includes('Tributos');
    
    if (salvarBtn || (qtdLabel && modalTitle)) {
      return true;
    }
    
    await sleep(300);
  }
  
  return false;
}

// Fill the quantity and save
async function fillAndSave(newQty, productCode) {
  try {
    console.log('SEFAZ Editor - Looking for Qtd. Comercial field');
    
    // Find the Qtd. Comercial input
    let qtyInput = null;
    
    // Look for input near "Qtd. Comercial" text
    const allTds = document.querySelectorAll('td');
    for (const td of allTds) {
      const text = td.textContent.trim();
      if (text.includes('Qtd. Comercial') || text.includes('Qtd Comercial') || text === '*Qtd. Comercial:') {
        const row = td.closest('tr');
        if (row) {
          const inputs = row.querySelectorAll('input[type="text"], input:not([type="checkbox"]):not([type="hidden"]):not([type="button"])');
          for (const inp of inputs) {
            if (!inp.readOnly && !inp.disabled && inp.offsetParent !== null) {
              qtyInput = inp;
              break;
            }
          }
        }
        const nextTd = td.nextElementSibling;
        if (!qtyInput && nextTd) {
          const inp = nextTd.querySelector('input');
          if (inp && !inp.readOnly && !inp.disabled) {
            qtyInput = inp;
          }
        }
        if (qtyInput) break;
      }
    }
    
    // Fallback: find input with qty pattern
    if (!qtyInput) {
      const allInputs = document.querySelectorAll('input[type="text"], input:not([type])');
      for (const inp of allInputs) {
        if (inp.value && inp.value.match(/^\d+,\d{4}$/) && !inp.readOnly && inp.offsetParent !== null) {
          qtyInput = inp;
          break;
        }
      }
    }
    
    if (!qtyInput) {
      throw new Error('Campo Qtd. Comercial não encontrado');
    }
    
    console.log('SEFAZ Editor - Found qty input, current value:', qtyInput.value);
    
    // Update the quantity
    qtyInput.focus();
    await sleep(200);
    qtyInput.select();
    await sleep(100);
    
    // Format quantity
    let formattedQty = newQty.replace('.', ',');
    if (!formattedQty.includes(',')) {
      formattedQty = formattedQty + ',0000';
    } else {
      const parts = formattedQty.split(',');
      formattedQty = parts[0] + ',' + (parts[1] || '').padEnd(4, '0').substring(0, 4);
    }
    
    qtyInput.value = '';
    qtyInput.value = formattedQty;
    qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
    qtyInput.dispatchEvent(new Event('change', { bubbles: true }));
    qtyInput.dispatchEvent(new Event('blur', { bubbles: true }));
    
    console.log('SEFAZ Editor - Set quantity to:', formattedQty);
    await sleep(500);
    
    // Click Salvar Item
    const saveBtn = findButton('Salvar Item');
    if (!saveBtn) {
      throw new Error('Botão Salvar Item não encontrado');
    }
    
    console.log('SEFAZ Editor - Clicking Salvar Item');
    saveBtn.click();
    await sleep(2500);
    
    console.log('SEFAZ Editor - Product', productCode, 'edited successfully!');
    return { success: true };
    
  } catch (error) {
    throw error;
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
