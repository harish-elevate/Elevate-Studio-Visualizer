import { state, db, loadDataFromSupabase } from './state.js';
import { supabase } from './supabaseClient.js';

// --- DOM UTILITIES ---
const getEl = (id) => document.getElementById(id);
const hide = (id) => getEl(id).classList.add('hidden');
const show = (id) => getEl(id).classList.remove('hidden');

// --- WIZARD STATE ---
let wizardSteps = []; 
let currentStepIndex = 0;

// --- INITIALIZATION ---
async function initializeClientApp() {
    getEl('globalLoader').classList.remove('hidden');
    await loadDataFromSupabase();
    renderLandingPage();
    getEl('globalLoader').classList.add('hidden');
}

// --- LANDING PAGE LOGIC ---
function renderLandingPage() {
    const grid = getEl('modelHomeGrid');
    grid.innerHTML = '';
    
    if (db.ModelHome.length === 0) {
        grid.innerHTML = '<p>No models available currently. Please check back later.</p>';
        return;
    }
    
    db.ModelHome.forEach(model => {
        const card = document.createElement('a');
        card.className = 'model-home-card';
        card.href = '#';
        card.style.textDecoration = 'none'; // Keeps text looking clean
        
        // Added the description paragraph below the name
        card.innerHTML = `
            <img src="${model.CoverImage}" alt="${model.Name}" class="model-home-card-image">
            <div class="model-home-card-name" style="margin-bottom: 5px;">${model.Name}</div>
            ${model.Description ? `<p style="font-size: 0.9rem; color: #666; margin: 0 15px 15px; text-align: center; line-height: 1.4;">${model.Description}</p>` : ''}
        `;
        
        card.addEventListener('click', (e) => {
            e.preventDefault();
            startWizard(model.id);
        });
        
        grid.appendChild(card);
    });
}

// --- WIZARD LOGIC ---
function startWizard(modelId) {
    state.currentModelHomeId = modelId;
    
    const floors = db.Floor.filter(f => f.BelongsToModel === modelId);
    
    wizardSteps = floors.sort((a, b) => {
        const aIsElev = a.Name.toLowerCase().includes('elevation') || a.Name.toLowerCase().includes('exterior');
        const bIsElev = b.Name.toLowerCase().includes('elevation') || b.Name.toLowerCase().includes('exterior');
        if (aIsElev && !bIsElev) return -1;
        if (!aIsElev && bIsElev) return 1;
        return a.id - b.id;
    });

    wizardSteps.push({ isReview: true, Name: 'Review & Publish' });

    currentStepIndex = 0;
    buildWizardProgressBar();
    
    hide('landingPage');
    show('wizardPage');
    
    loadWizardStep();
}

function buildWizardProgressBar() {
    const bar = document.querySelector('.wizard-progress-bar');
    bar.innerHTML = ''; 
    
    wizardSteps.forEach((step, index) => {
        const stepEl = document.createElement('div');
        stepEl.className = 'wizard-step';
        stepEl.id = `step-indicator-${index}`;
        stepEl.textContent = `${index + 1}. ${step.Name}`;
        bar.appendChild(stepEl);
    });
}

let clientCanvas = null;
let lastRenderedFloorId = null; 
let currentActiveSidebarContext = null; 

function loadWizardStep() {
    wizardSteps.forEach((step, index) => {
        const el = getEl(`step-indicator-${index}`);
        el.classList.remove('active', 'completed');
        if (index < currentStepIndex) el.classList.add('completed');
        if (index === currentStepIndex) el.classList.add('active');
    });

    const currentStepData = wizardSteps[currentStepIndex];

    if (currentStepData.isReview) {
        hide('wizardPage');
        show('reviewPage');
        renderReviewPage();
        return;
    }

    state.currentFloorId = currentStepData.id;
    
    const isElevation = currentStepData.Name.toLowerCase().includes('elevation') || currentStepData.Name.toLowerCase().includes('exterior');
    
    if (isElevation) {
        const floorSets = db.OptionSet.filter(os => os.BelongsToFloor === currentStepData.id);
        const targets = floorSets.map(s => ({ id: s.id, type: 'OptionSet' }));
        openSidebarMenu(targets);
    } else {
        show('sidebarDefaultMessage');
        hide('customizerOptionSets');
    }
    
    getEl('wizardBackBtn').classList.toggle('hidden', currentStepIndex === 0);
    getEl('wizardNextBtn').textContent = currentStepIndex === wizardSteps.length - 2 ? 'Review Design →' : 'Next Step →';

    renderClientCanvas(currentStepData);
}

function renderClientCanvas(floorData) {
    const container = getEl('customizerCanvasContainer').parentElement;
    const canvasWidth = container.offsetWidth;
    const canvasHeight = container.offsetHeight;

    if (!clientCanvas) {
        clientCanvas = new fabric.Canvas('markupCanvas', { 
            selection: false, preserveObjectStacking: true, defaultCursor: 'grab'
        });

        clientCanvas.on('mouse:wheel', function(opt) {
            var delta = opt.e.deltaY;
            var zoom = clientCanvas.getZoom();
            zoom *= 0.999 ** delta;
            if (zoom > 5) zoom = 5; 
            if (zoom < 0.2) zoom = 0.2; 
            clientCanvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
            opt.e.preventDefault();
            opt.e.stopPropagation();
        });

        let isDragging = false;
        let hasMoved = false; // <--- NEW: Tracks if it's a drag or a click
        let lastPosX, lastPosY;

        clientCanvas.on('mouse:down', function(opt) {
            if (opt.target && opt.target.data && opt.target.data.isGear) return;
            
            const evt = opt.e;
            isDragging = true;
            hasMoved = false; // Reset on every click
            clientCanvas.setCursor('grabbing');
            
            if(evt.touches && evt.touches[0]) {
                lastPosX = evt.touches[0].clientX;
                lastPosY = evt.touches[0].clientY;
            } else {
                lastPosX = evt.clientX;
                lastPosY = evt.clientY;
            }
        });

        clientCanvas.on('mouse:move', function(opt) {
            if (isDragging) {
                const e = opt.e;
                let currX, currY;
                if(e.touches && e.touches[0]) {
                    currX = e.touches[0].clientX;
                    currY = e.touches[0].clientY;
                } else {
                    currX = e.clientX;
                    currY = e.clientY;
                }
                
                // If they moved more than 2 pixels, it's an official drag
                if (Math.abs(currX - lastPosX) > 2 || Math.abs(currY - lastPosY) > 2) {
                    hasMoved = true;
                }

                // Only move the canvas if it's an official drag
                if (hasMoved) {
                    const vpt = clientCanvas.viewportTransform;
                    vpt[4] += currX - lastPosX;
                    vpt[5] += currY - lastPosY;
                    clientCanvas.requestRenderAll();
                    lastPosX = currX;
                    lastPosY = currY;
                }
            }
        });

        clientCanvas.on('mouse:up', function(opt) {
            if (isDragging) {
                clientCanvas.setViewportTransform(clientCanvas.viewportTransform);
                isDragging = false;
                clientCanvas.setCursor('grab');
                
                // If they released the mouse but NEVER moved, it was just a click!
                if (!hasMoved) {
                    hide('customizerOptionSets');
                    show('sidebarDefaultMessage');
                    currentActiveSidebarContext = null;
                }
            } 
        });

        clientCanvas.on('touch:gesture', function(e) {
            if (e.e.touches && e.e.touches.length == 2) {
                e.e.preventDefault(); 
                if (e.self.state == "start") {
                    clientCanvas.startZoom = clientCanvas.getZoom();
                }
                var zoom = clientCanvas.startZoom * e.self.scale;
                if (zoom > 5) zoom = 5;
                if (zoom < 0.2) zoom = 0.2;
                var point = new fabric.Point(e.self.x, e.self.y);
                clientCanvas.zoomToPoint(point, zoom);
            }
        });
    }

    clientCanvas.setDimensions({ width: canvasWidth, height: canvasHeight });

    let imageUrl = floorData.BasePlanImage;
    if (imageUrl === 'null') imageUrl = null;

    const isElevation = floorData.Name.toLowerCase().includes('elevation') || floorData.Name.toLowerCase().includes('exterior');

    if (isElevation && !imageUrl) {
        const optionSetsForFloor = db.OptionSet.filter(os => os.BelongsToFloor === floorData.id).map(os => os.id);
        const selectedOptionIds = Object.values(state.customizerSelections).flat();
        const selectedOption = db.Option.find(opt => optionSetsForFloor.includes(opt.BelongsToOptionSet) && selectedOptionIds.includes(opt.id));
        
        if (selectedOption && selectedOption.OptionImage && selectedOption.OptionImage !== 'null') {
            imageUrl = selectedOption.OptionImage;
        }
    }

    if (lastRenderedFloorId === floorData.id && clientCanvas.lastImageUrl === imageUrl) {
        diffAndRenderCanvas(floorData, clientCanvas.bgMetrics);
        return;
    }

    lastRenderedFloorId = floorData.id;
    clientCanvas.lastImageUrl = imageUrl;
    
    clientCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]); 
    
    clientCanvas.clear();

    if (!imageUrl) {
        clientCanvas.setBackgroundColor('#ffffff', clientCanvas.renderAll.bind(clientCanvas));
        const text = new fabric.Text(isElevation ? 'Choose The Elevation For Your Home' : 'No Floor Plan Available', {
            fontSize: 20, fill: '#999', fontFamily: 'Montserrat', originX: 'center', originY: 'center',
            left: canvasWidth / 2, top: canvasHeight / 2, selectable: false
        });
        clientCanvas.add(text);
        clientCanvas.bgMetrics = { offsetX: 0, offsetY: 0, width: canvasWidth, height: canvasHeight };
        
        if (!isElevation) renderGearIcons(floorData, clientCanvas.bgMetrics);
        return;
    }

    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
        const scale = Math.min(canvasWidth / image.width, canvasHeight / image.height);
        const bgOffsetX = (canvasWidth - image.width * scale) / 2;
        const bgOffsetY = (canvasHeight - image.height * scale) / 2;
        
        clientCanvas.bgMetrics = { offsetX: bgOffsetX, offsetY: bgOffsetY, width: image.width * scale, height: image.height * scale };

        clientCanvas.setBackgroundImage(imageUrl, clientCanvas.renderAll.bind(clientCanvas), {
            originX: 'left', originY: 'top', crossOrigin: 'anonymous', 
            scaleX: scale, scaleY: scale, left: bgOffsetX, top: bgOffsetY
        });

        renderActiveOverlays(floorData, clientCanvas.bgMetrics).then(() => {
            if (!isElevation) renderGearIcons(floorData, clientCanvas.bgMetrics);
        });
    };
    image.onerror = () => {
        clientCanvas.setBackgroundColor('#f0f0f0', clientCanvas.renderAll.bind(clientCanvas));
    };
    image.src = imageUrl;
}

function getOptionLogicStatus(option) {
    // 1. Is it already selected?
    const currentSelections = state.customizerSelections[option.BelongsToOptionSet];
    const isSelected = Array.isArray(currentSelections) ? currentSelections.includes(option.id) : currentSelections === option.id;
    if (isSelected) return { status: 'selected' };

    // 2. Does it have an active conflict?
    let activeConflicts = [];
    if (option.conflicts && option.conflicts.length > 0) {
        activeConflicts = option.conflicts.filter(conflictId => {
            const conflictOpt = db.Option.find(o => o.id === conflictId);
            if (!conflictOpt) return false;
            const selectedInSet = state.customizerSelections[conflictOpt.BelongsToOptionSet];
            return Array.isArray(selectedInSet) ? selectedInSet.includes(conflictId) : selectedInSet === conflictId;
        });
    }
    if (activeConflicts.length > 0) return { status: 'conflict', items: activeConflicts };

    // 3. Is it missing a prerequisite?
    let missingReqs = [];
    if (option.requirements && option.requirements.length > 0) {
        missingReqs = option.requirements.filter(reqId => {
            const reqOpt = db.Option.find(o => o.id === reqId);
            if (!reqOpt) return true; 
            const selectedInSet = state.customizerSelections[reqOpt.BelongsToOptionSet];
            return Array.isArray(selectedInSet) ? !selectedInSet.includes(reqId) : selectedInSet !== reqId;
        });
    }
    if (missingReqs.length > 0) return { status: 'locked', items: missingReqs };

    // 4. Good to go!
    return { status: 'available' };
}

function getCollateralDamage(optId, found = new Set()) {
    const allSelectedIds = Object.values(state.customizerSelections).flat();
    
    allSelectedIds.forEach(selectedId => {
        if (selectedId === optId || found.has(selectedId)) return;
        const opt = db.Option.find(o => o.id === selectedId);
        
        // If this selected option requires the one we are about to delete
        if (opt && opt.requirements && opt.requirements.includes(optId)) {
            found.add(selectedId);
            getCollateralDamage(selectedId, found); // Check for chains!
        }
    });
    
    return Array.from(found).map(id => db.Option.find(o => o.id === id));
}

async function diffAndRenderCanvas(floorData, bgMetrics) {
    const isElevation = floorData.Name.toLowerCase().includes('elevation') || floorData.Name.toLowerCase().includes('exterior');
    const optionSets = db.OptionSet.filter(os => os.BelongsToFloor === floorData.id);
    const selectedIds = Object.values(state.customizerSelections).flat();
    
    const optionsToDraw = db.Option
        .filter(opt => optionSets.map(s => s.id).includes(opt.BelongsToOptionSet) && selectedIds.includes(opt.id))
        .filter(opt => opt.OptionImage && opt.OptionImage !== 'null');
        
    const intendedOverlayIds = optionsToDraw.map(o => o.id);
    const currentObjects = clientCanvas.getObjects();
    
    // 1. Remove overlays that are NO LONGER selected
    currentObjects.forEach(obj => {
        if (obj.data && obj.data.isOverlay) {
            if (!intendedOverlayIds.includes(obj.data.optionId)) clientCanvas.remove(obj);
        }
    });
    
    // 2. Add NEW overlays
    const existingOverlayIds = clientCanvas.getObjects().filter(o => o.data && o.data.isOverlay).map(o => o.data.optionId);
    
    for (const option of optionsToDraw) {
        if (!existingOverlayIds.includes(option.id)) {
            await new Promise((resolve) => {
                fabric.Image.fromURL(option.OptionImage, (img) => {
                    let left = bgMetrics.offsetX + (option.X_Position / 100) * bgMetrics.width;
                    let top = bgMetrics.offsetY + (option.Y_Position / 100) * bgMetrics.height;
                    let scaleX = ((option.Width / 100) * bgMetrics.width) / (img.width || 1);
                    let scaleY = ((option.Height / 100) * bgMetrics.height) / (img.height || 1);

                    if (isElevation) {
                        left = bgMetrics.offsetX;
                        top = bgMetrics.offsetY;
                        scaleX = bgMetrics.width / (img.width || 1);
                        scaleY = bgMetrics.height / (img.height || 1);
                    }

                    // Extract layer order (Prioritize layer_order, fallback to position, fallback to 0)
                    const layerVal = option.layer_order !== null && option.layer_order !== undefined 
                        ? option.layer_order 
                        : (option.position || 0);

                    img.set({
                        left: left, top: top, scaleX: scaleX, scaleY: scaleY,
                        selectable: false, evented: false,
                        data: { isOverlay: true, optionId: option.id, layerOrder: Number(layerVal) }
                    });
                    clientCanvas.add(img);
                    resolve();
                }, { crossOrigin: 'anonymous' });
            });
        }
    }
    
    // 3. THE FIX: Official Fabric.js Z-Index Stacking (INVERTED!)
    const overlays = clientCanvas.getObjects().filter(o => o.data && o.data.isOverlay);
    
    // Sort them so highest numbers go to the back, lowest numbers (1) go to the front
    overlays.sort((a, b) => {
        const valA = Number(a.data.layerOrder) || 0;
        const valB = Number(b.data.layerOrder) || 0;
        return valB - valA; // <--- The magic flip
    });

    overlays.forEach((obj, index) => {
        clientCanvas.moveTo(obj, index);
    });

    // 4. Quickly redraw the gears so they reflect prerequisite changes and stay on absolute top
    clientCanvas.getObjects().forEach(obj => {
        if (obj.data && obj.data.isGear) clientCanvas.remove(obj);
    });
    
    if (!isElevation) {
        renderGearIcons(floorData, bgMetrics);
    } else {
        clientCanvas.renderAll();
    }
}

window.triggerLogicModal = (targetOptId, type, itemIdsString) => {
    const targetOpt = db.Option.find(o => o.id === targetOptId);
    const itemIds = itemIdsString.split(',').map(Number);
    const items = itemIds.map(id => db.Option.find(o => o.id === id));

    getEl('modalTitle').textContent = type === 'req' ? 'Unlock Feature' : 'Conflicting Options';

    const form = getEl('modalForm');
    const saveBtn = getEl('modalSave');
    const cancelBtn = getEl('modalCancel');

    // Build beautiful mini-cards for the prerequisites/conflicts
    const itemsHtml = items.map(i => `
        <div style="display: flex; align-items: center; gap: 15px; padding: 10px; border: 1px solid #eee; border-radius: 8px; margin-bottom: 10px; background: #fafafa;">
            <img src="${i.Thumbnail !== 'null' ? i.Thumbnail : ''}" alt="${i.Name}" style="width: 80px; height: 80px; object-fit: contain; background: #fff; border-radius: 4px; border: 1px solid #ddd;">
            <div>
                <div style="font-weight: bold; color: var(--headings-dark); font-size: 1rem;">${i.Name}</div>
                ${i.Description ? `<div style="font-size: 0.8rem; color: #666; margin-top: 4px; line-height: 1.3;">${i.Description}</div>` : ''}
            </div>
        </div>
    `).join('');

    // Inject the content based on whether it's a conflict or a requirement
    if (type === 'req') {
         form.innerHTML = `
            <p style="margin-bottom:15px; line-height:1.5; color:#555; font-size: 0.95rem;">To add <strong>${targetOpt.Name}</strong>, you must also add the following prerequisite(s) to your plan:</p>
            <div style="margin-bottom: 20px;">${itemsHtml}</div>`;
    } else {
         form.innerHTML = `
            <p style="margin-bottom:15px; line-height:1.5; color:#555; font-size: 0.95rem;">Adding <strong>${targetOpt.Name}</strong> will remove the following conflicting item(s) from your plan:</p>
            <div style="margin-bottom: 20px;">${itemsHtml}</div>`;
    }

    // Unhide and setup the Cancel Button
    cancelBtn.classList.remove('hidden');
    cancelBtn.style.display = 'inline-block';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => hide('modal');

    // Safely override the Save Button
    const newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);

    newSaveBtn.classList.remove('hidden');
    newSaveBtn.style.display = 'inline-block';
    newSaveBtn.textContent = type === 'req' ? 'Add All to Plan' : 'Swap Options';

    // The Logic Engine for Swaps and Additions
    newSaveBtn.onclick = () => {
        const floorData = wizardSteps[currentStepIndex];

        if (type === 'req') {
            // Add all requirements
            items.forEach(req => {
                if (!state.customizerSelections[req.BelongsToOptionSet]) state.customizerSelections[req.BelongsToOptionSet] = [];
                if (!state.customizerSelections[req.BelongsToOptionSet].includes(req.id)) {
                     state.customizerSelections[req.BelongsToOptionSet].push(req.id);
                }
            });
        } else {
            // Remove all conflicts
            items.forEach(conf => {
                if (state.customizerSelections[conf.BelongsToOptionSet]) {
                    state.customizerSelections[conf.BelongsToOptionSet] = state.customizerSelections[conf.BelongsToOptionSet].filter(id => id !== conf.id);
                    if (state.customizerSelections['gallery_picks']) delete state.customizerSelections['gallery_picks'][conf.id];
                }
            });
        }

        // Add the target option they originally clicked
        const targetSet = db.OptionSet.find(s => s.id === targetOpt.BelongsToOptionSet);
        if (!state.customizerSelections[targetSet.id]) state.customizerSelections[targetSet.id] = [];
        
        if (!targetSet.allow_multiple_selections) {
             state.customizerSelections[targetSet.id] = [targetOpt.id];
        } else {
             if (!state.customizerSelections[targetSet.id].includes(targetOpt.id)) {
                 state.customizerSelections[targetSet.id].push(targetOpt.id);
             }
        }

        // Redraw canvas and sidebar
        renderClientCanvas(floorData);
        openSidebarMenu(currentActiveSidebarContext); 
        hide('modal');
    };

    show('modal');
};

window.triggerCollateralModal = (targetOpt, collateralItems, actionType, set) => {
    getEl('modalTitle').textContent = 'Warning: Dependent Options';
    const form = getEl('modalForm');
    const saveBtn = getEl('modalSave');
    const cancelBtn = getEl('modalCancel');

    const itemsHtml = collateralItems.map(i => `
        <div style="display: flex; align-items: center; gap: 15px; padding: 10px; border: 1px solid #eee; border-radius: 8px; margin-bottom: 10px; background: #fafafa;">
            <img src="${i.Thumbnail !== 'null' ? i.Thumbnail : ''}" alt="${i.Name}" style="width: 80px; height: 80px; object-fit: contain; background: #fff; border-radius: 4px; border: 1px solid #ddd;">
            <div>
                <div style="font-weight: bold; color: var(--headings-dark); font-size: 1rem;">${i.Name}</div>
            </div>
        </div>
    `).join('');

    if (actionType === 'remove') {
        form.innerHTML = `
            <p style="margin-bottom:15px; line-height:1.5; color:#555; font-size: 0.95rem;">Removing <strong>${targetOpt.Name}</strong> will also remove the following item(s) that depend on it:</p>
            <div style="margin-bottom: 20px;">${itemsHtml}</div>`;
    } else if (actionType === 'swap') {
        form.innerHTML = `
            <p style="margin-bottom:15px; line-height:1.5; color:#555; font-size: 0.95rem;">Selecting <strong>${targetOpt.Name}</strong> will replace your current selection and remove the following dependent item(s):</p>
            <div style="margin-bottom: 20px;">${itemsHtml}</div>`;
    }

    cancelBtn.classList.remove('hidden');
    cancelBtn.style.display = 'inline-block';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => hide('modal');

    const newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);

    newSaveBtn.classList.remove('hidden');
    newSaveBtn.style.display = 'inline-block';
    newSaveBtn.textContent = actionType === 'remove' ? 'Remove All' : 'Continue & Swap';
    newSaveBtn.style.cssText = `padding: 10px 20px; border-radius: 6px; border: none; font-weight: bold; cursor: pointer; color: white; background: #f44336;`;

    newSaveBtn.onclick = () => {
        // 1. Silently remove all collateral damage first
        collateralItems.forEach(coll => {
            const collSet = db.OptionSet.find(s => s.id === coll.BelongsToOptionSet);
            if (state.customizerSelections[collSet.id]) {
                state.customizerSelections[collSet.id] = state.customizerSelections[collSet.id].filter(id => id !== coll.id);
                if (state.customizerSelections['gallery_picks']) delete state.customizerSelections['gallery_picks'][coll.id];
            }
        });
        
        // 2. Execute the original action (This handles re-rendering the canvas!)
        handleOptionClick(targetOpt, set);
        hide('modal');
    };

    show('modal');
};

async function renderActiveOverlays(floorData, bgMetrics) {
    const isElevation = floorData.Name.toLowerCase().includes('elevation') || floorData.Name.toLowerCase().includes('exterior');
    const optionSets = db.OptionSet.filter(os => os.BelongsToFloor === floorData.id);
    const selectedIds = Object.values(state.customizerSelections).flat();
    
    const optionsToDraw = db.Option
        .filter(opt => optionSets.map(s => s.id).includes(opt.BelongsToOptionSet) && selectedIds.includes(opt.id))
        .sort((a, b) => {
            // INVERTED SORT: Draw highest numbers first (bottom), lowest numbers last (top)
            const valA = a.layer_order !== null && a.layer_order !== undefined ? Number(a.layer_order) : Number(a.position || 0);
            const valB = b.layer_order !== null && b.layer_order !== undefined ? Number(b.layer_order) : Number(b.position || 0);
            return valB - valA; // <--- The magic flip
        });

    for (const option of optionsToDraw) {
        if (!option.OptionImage || option.OptionImage === 'null') continue;
        
        await new Promise((resolve) => {
            fabric.Image.fromURL(option.OptionImage, (img) => {
                let left = bgMetrics.offsetX + (option.X_Position / 100) * bgMetrics.width;
                let top = bgMetrics.offsetY + (option.Y_Position / 100) * bgMetrics.height;
                let scaleX = ((option.Width / 100) * bgMetrics.width) / (img.width || 1);
                let scaleY = ((option.Height / 100) * bgMetrics.height) / (img.height || 1);

                if (isElevation) {
                    left = bgMetrics.offsetX;
                    top = bgMetrics.offsetY;
                    scaleX = bgMetrics.width / (img.width || 1);
                    scaleY = bgMetrics.height / (img.height || 1);
                }

                const layerVal = option.layer_order !== null && option.layer_order !== undefined 
                    ? option.layer_order 
                    : (option.position || 0);

                img.set({
                    left: left, top: top, scaleX: scaleX, scaleY: scaleY,
                    selectable: false, evented: false,
                    data: { isOverlay: true, optionId: option.id, layerOrder: Number(layerVal) }
                });
                clientCanvas.add(img);
                resolve();
            }, { crossOrigin: 'anonymous' });
        });
    }
}

const getGearKey = (x, y) => `${Number(x).toFixed(4)},${Number(y).toFixed(4)}`;

function renderGearIcons(floorData, bgMetrics) {
    // 1. DEFAULT STATE: More transparent glass circle (55% white) with a grey plus sign
    const defaultIconUrl = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="rgba(255, 255, 255, 0.55)" stroke="none"/><path d="M16 10v12M10 16h12" stroke="%23888888" stroke-width="2" stroke-linecap="round"/></svg>';
    
    // 2. ACTIVE / HOVER STATE: Solid white circle (95% white) with orange plus sign
    const activeIconUrl = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="rgba(255, 255, 255, 0.95)" stroke="none"/><path d="M16 10v12M10 16h12" stroke="%23ec8d44" stroke-width="2" stroke-linecap="round"/></svg>';

    const floorSets = db.OptionSet.filter(os => os.BelongsToFloor === floorData.id);
    const allSelectedIds = Object.values(state.customizerSelections).flat();
    const gearMap = new Map();

    // MAP SET-LEVEL HOTSPOTS (and check if they have a selection)
    floorSets.filter(os => (!os.icon_mode || os.icon_mode === 'set_level') && os.Gear_X !== null).forEach(os => {
        const key = getGearKey(os.Gear_X, os.Gear_Y);
        const hasSelection = state.customizerSelections[os.id] && state.customizerSelections[os.id].length > 0;
        
        if (!gearMap.has(key)) {
            gearMap.set(key, { x: os.Gear_X, y: os.Gear_Y, isActive: hasSelection }); 
        } else if (hasSelection) {
            gearMap.get(key).isActive = true; // If multiple sets share a dot, mark active if ANY are selected
        }
    });

    // MAP OPTION-LEVEL HOTSPOTS (and check if they are selected)
    const floorOptions = db.Option.filter(o => floorSets.map(s => s.id).includes(o.BelongsToOptionSet) && o.Gear_X !== null);
    
    floorOptions.forEach(opt => {
        
        const parentSet = floorSets.find(s => s.id === opt.BelongsToOptionSet);
        if (parentSet && parentSet.icon_mode === 'option_level') {
            const key = getGearKey(opt.Gear_X, opt.Gear_Y);
            const isSelected = allSelectedIds.includes(opt.id);
            
            if (!gearMap.has(key)) {
                gearMap.set(key, { x: opt.Gear_X, y: opt.Gear_Y, isActive: isSelected });
            } else if (isSelected) {
                gearMap.get(key).isActive = true;
            }
        }
    });

    // RENDER THE ICONS
    gearMap.forEach((data, keyString) => {
        const { x, y, isActive } = data;
        
        // If it's already customized, render it as Active (Orange). Otherwise, Default (Grey).
        const initialIconUrl = isActive ? activeIconUrl : defaultIconUrl;

        fabric.Image.fromURL(initialIconUrl, (img) => {
            const left = bgMetrics.offsetX + (x / 100) * bgMetrics.width - (img.width/2);
            const top = bgMetrics.offsetY + (y / 100) * bgMetrics.height - (img.height/2);

            img.set({
                left: left, top: top,
                selectable: false, evented: true, hoverCursor: 'pointer',
                shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.15)', blur: 6, offsetX: 0, offsetY: 2 }),
                data: { isGear: true, layerOrder: 9999 } 
            });
            
            // Hover logic: only change colors if it isn't ALREADY active
            img.on('mouseover', () => {
                if (!isActive) img.setSrc(activeIconUrl, () => clientCanvas.renderAll());
            });
            
            img.on('mouseout', () => {
                if (!isActive) img.setSrc(defaultIconUrl, () => clientCanvas.renderAll());
            });
            
            img.on('mousedown', () => openSidebarMenu(keyString));
            
            clientCanvas.add(img);
        });
    });
}

function captureCanvasSnapshot() {
    if (!clientCanvas || !clientCanvas.bgMetrics) return null;

    const originalVpt = clientCanvas.viewportTransform.slice();
    clientCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

    // FIX: Temporarily force a pure white background so the JPEG doesn't render transparent padding as black
    const originalBgColor = clientCanvas.backgroundColor;
    clientCanvas.backgroundColor = '#ffffff';

    const gears = clientCanvas.getObjects().filter(o => o.data && o.data.isGear);
    const texts = clientCanvas.getObjects().filter(o => o.type === 'text');
    
    gears.forEach(g => g.set({ opacity: 0 }));
    texts.forEach(t => t.set({ opacity: 0 }));
    clientCanvas.renderAll();

    let minX = clientCanvas.bgMetrics.offsetX;
    let minY = clientCanvas.bgMetrics.offsetY;
    let maxX = minX + clientCanvas.bgMetrics.width;
    let maxY = minY + clientCanvas.bgMetrics.height;
    
    const visibleObjects = clientCanvas.getObjects().filter(o => o.opacity !== 0 && o.data && o.data.isOverlay);
    visibleObjects.forEach(obj => {
        const bound = obj.getBoundingRect();
        if (bound.left < minX) minX = bound.left;
        if (bound.top < minY) minY = bound.top;
        if (bound.left + bound.width > maxX) maxX = bound.left + bound.width;
        if (bound.top + bound.height > maxY) maxY = bound.top + bound.height;
    });

    const padding = 10;

    const dataUrl = clientCanvas.toDataURL({ 
        format: 'jpeg', 
        quality: 0.8, 
        left: minX - padding,
        top: minY - padding,
        width: (maxX - minX) + (padding * 2),
        height: (maxY - minY) + (padding * 2),
        multiplier: 2 
    });

    // Restore the canvas back to exactly how the user left it
    gears.forEach(g => g.set({ opacity: 1 }));
    texts.forEach(t => t.set({ opacity: 1 }));
    clientCanvas.backgroundColor = originalBgColor;
    clientCanvas.setViewportTransform(originalVpt);
    clientCanvas.renderAll();

    return dataUrl;
}

function openSidebarMenu(context) {
    currentActiveSidebarContext = context;
    let targets = [];
    const allSelectedIds = Object.values(state.customizerSelections).flat();
    const floorData = wizardSteps[currentStepIndex];
    const isElevation = floorData.Name.toLowerCase().includes('elevation') || floorData.Name.toLowerCase().includes('exterior');

    hide('sidebarDefaultMessage');

    if (Array.isArray(context)) {
        targets = context;
    } else if (typeof context === 'string') {
        const floorSets = db.OptionSet.filter(os => os.BelongsToFloor === floorData.id);
        floorSets.filter(os => (!os.icon_mode || os.icon_mode === 'set_level') && os.Gear_X !== null).forEach(os => {
            if (getGearKey(os.Gear_X, os.Gear_Y) === context) targets.push({ id: os.id, type: 'OptionSet' });
        });
        const floorOptions = db.Option.filter(o => floorSets.map(s => s.id).includes(o.BelongsToOptionSet) && o.Gear_X !== null);
        floorOptions.forEach(opt => {
           
            const parentSet = floorSets.find(s => s.id === opt.BelongsToOptionSet);
            if (parentSet?.icon_mode === 'option_level' && getGearKey(opt.Gear_X, opt.Gear_Y) === context) targets.push({ id: opt.id, type: 'Option' });
        });
    }

    if (targets.length === 0) return;

    const container = getEl('customizerOptionSets');
    container.innerHTML = ''; 
    const renderData = {}; 

    targets.forEach(target => {
        const optRef = target.type === 'Option' ? db.Option.find(o => o.id === target.id) : null;
        const set = target.type === 'OptionSet' ? db.OptionSet.find(s => s.id === target.id) : (optRef ? db.OptionSet.find(s => s.id === optRef.BelongsToOptionSet) : null);
        if (!set) return;
        if (!renderData[set.id]) renderData[set.id] = { set, options: [] };
        if (target.type === 'OptionSet') {
            db.Option.filter(o => o.BelongsToOptionSet === set.id).sort((a,b) => a.position - b.position).forEach(o => {
                if (!renderData[set.id].options.some(ex => ex.id === o.id)) renderData[set.id].options.push(o);
            });
        } else if (optRef && !renderData[set.id].options.some(ex => ex.id === optRef.id)) {
            renderData[set.id].options.push(optRef);
        }
    });

    Object.keys(renderData).forEach(setId => {
        const { set, options } = renderData[setId];
        
        const header = document.createElement('h3');
        header.style.cssText = `margin: 20px 0 10px; color: var(--primary-color); border-bottom: 2px solid #eee; padding-bottom: 5px; font-size: 1.1rem;`;
        header.textContent = set.Name;
        container.appendChild(header);
        
        const grid = document.createElement('div');
        grid.style.cssText = `display: grid; grid-template-columns: ${isElevation ? '1fr 1fr' : '1fr'}; gap: 15px; margin-bottom: 30px;`;

        options.forEach(opt => {
            const isSelected = (state.customizerSelections[set.id] || []).includes(opt.id);
            const card = document.createElement('div');
            
            let hasValidGallery = false;
            try {
                let parsed = typeof opt.gallery_images === 'string' ? JSON.parse(opt.gallery_images) : opt.gallery_images;
                if (typeof parsed === 'string') parsed = JSON.parse(parsed); 
                if (Array.isArray(parsed) && parsed.length > 0 && parsed.some(img => {
                    const url = img.url || img.Url || img.URL || img.image;
                    return url && url.trim() !== '';
                })) {
                    hasValidGallery = true;
                }
            } catch(e) {}

            const imgHeight = isElevation ? '200px' : '220px';

            card.style.cssText = `position: relative; border: ${isSelected ? '2px solid var(--primary-color)' : '1px solid #ddd'}; border-radius: 8px; overflow: hidden; background: #fff; cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 5px rgba(0,0,0,0.05);`;

            card.innerHTML = `
                ${(!isElevation && hasValidGallery) ? '<div style="position:absolute; top:8px; left:8px; background:rgba(255,255,255,0.9); padding:4px 8px; border-radius:20px; font-size:10px; font-weight:bold; color:var(--primary-color); z-index:2; border:1px solid #eee;"><span class="material-symbols-outlined" style="font-size:14px; vertical-align:middle; margin-right:4px;">photo_camera</span>Styles</div>' : ''}
                <div style="height: ${imgHeight}; background: #fdfdfd; display: flex; align-items: center; justify-content: center; border-bottom: 1px solid #eee;">
                    <img src="${opt.Thumbnail}" style="max-width: 90%; max-height: 90%; object-fit: contain;">
                </div>
                <div style="padding: 12px; text-align: ${isElevation ? 'center' : 'left'};">
                    <div style="font-weight: bold; color: var(--headings-dark); font-size: ${isElevation ? '0.8rem' : '1.1rem'};">${opt.Name}</div>
                    
                    ${opt.Description ? `<div style="font-size: 0.75rem; color: #777; margin-top: 5px; line-height: 1.3;">${opt.Description}</div>` : ''}
                    
                    <div id="btn-container-${opt.id}" style="margin-top: 10px; display: flex; gap: 8px;"></div>
                </div>
            `;

            if (isElevation) {
                card.onclick = () => handleOptionClick(opt, set);
            } else {
                const btnContainer = card.querySelector(`#btn-container-${opt.id}`);
                
                // --- SMART BUTTON LOGIC ---
                const statusObj = getOptionLogicStatus(opt);
                
                if (statusObj.status === 'selected') {
                    const removeBtn = document.createElement('button');
                    removeBtn.textContent = 'Remove from Plan';
                    removeBtn.style.cssText = `flex: 1; padding: 10px; border-radius: 6px; border: none; font-weight: bold; cursor: pointer; background: #f44336; color: white; font-size: 0.8rem;`;
                    removeBtn.onclick = (e) => { 
                        e.stopPropagation(); 
                        const collateral = getCollateralDamage(opt.id);
                        if (collateral.length > 0) {
                            triggerCollateralModal(opt, collateral, 'remove', set);
                        } else {
                            handleOptionClick(opt, set); 
                        }
                    };
                    btnContainer.appendChild(removeBtn);
                } 
                else if (statusObj.status === 'available') {
                    const addBtn = document.createElement('button');
                    addBtn.textContent = 'Add to Plan';
                    addBtn.style.cssText = `flex: 1; padding: 10px; border-radius: 6px; border: none; font-weight: bold; cursor: pointer; background: var(--primary-color); color: white; font-size: 0.8rem;`;
                    addBtn.onclick = (e) => { 
                        e.stopPropagation(); 
                        
                        // Check if adding this will swap out an existing item that has collateral damage
                        let collateral = [];
                        if (!set.allow_multiple_selections) {
                            const existingIds = state.customizerSelections[set.id] || [];
                            existingIds.forEach(eid => {
                                if (eid !== opt.id) {
                                    collateral.push(...getCollateralDamage(eid));
                                }
                            });
                        }
                        
                        if (collateral.length > 0) {
                            // Deduplicate the list
                            const uniqueCollateral = [...new Map(collateral.map(item => [item.id, item])).values()];
                            triggerCollateralModal(opt, uniqueCollateral, 'swap', set);
                        } else {
                            handleOptionClick(opt, set); 
                        }
                    };
                    btnContainer.appendChild(addBtn);
                } 
                else if (statusObj.status === 'locked') {
                    const reqNames = statusObj.items.map(id => db.Option.find(o=>o.id===id)?.Name).join(', ');
                    const lockBtn = document.createElement('button');
                    lockBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px; vertical-align:middle; margin-right:4px;">lock</span> Add to Plan`;
                    lockBtn.style.cssText = `flex: 1; padding: 10px; border-radius: 6px; border: none; font-weight: bold; cursor: pointer; background: #999; color: white; font-size: 0.8rem;`;
                    lockBtn.onclick = (e) => { e.stopPropagation(); triggerLogicModal(opt.id, 'req', statusObj.items.join(',')); };
                    btnContainer.appendChild(lockBtn);
                    
                    const warning = document.createElement('div');
                    warning.style.cssText = `color: #d9534f; font-size: 0.75rem; margin-top: 8px; width: 100%; text-align: center; font-weight: bold;`;
                    warning.textContent = `* Requires: ${reqNames}`;
                    btnContainer.parentElement.appendChild(warning);
                    btnContainer.style.flexWrap = 'wrap'; // Allows warning to drop below buttons
                } 
                else if (statusObj.status === 'conflict') {
                    const confNames = statusObj.items.map(id => db.Option.find(o=>o.id===id)?.Name).join(', ');
                    const confBtn = document.createElement('button');
                    confBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px; vertical-align:middle; margin-right:4px;">lock</span> Add to Plan`;
                    confBtn.style.cssText = `flex: 1; padding: 10px; border-radius: 6px; border: none; font-weight: bold; cursor: pointer; background: #999; color: white; font-size: 0.8rem;`;
                    confBtn.onclick = (e) => { e.stopPropagation(); triggerLogicModal(opt.id, 'conflict', statusObj.items.join(',')); };
                    btnContainer.appendChild(confBtn);
                    
                    const warning = document.createElement('div');
                    warning.style.cssText = `color: #d9534f; font-size: 0.75rem; margin-top: 8px; width: 100%; text-align: center; font-weight: bold;`;
                    warning.textContent = `* Cannot use with: ${confNames}`;
                    btnContainer.parentElement.appendChild(warning);
                    btnContainer.style.flexWrap = 'wrap';
                }

                // Add Gallery Button if applicable
                if (hasValidGallery) {
                    const galBtn = document.createElement('button');
                    galBtn.textContent = 'Explore Styles';
                    galBtn.style.cssText = `flex: 1; padding: 10px; border-radius: 6px; border: 1px solid var(--primary-color); background: white; color: var(--primary-color); font-weight: bold; cursor: pointer; font-size: 0.8rem;`;
                    galBtn.onclick = (e) => { e.stopPropagation(); openGalleryModal(opt, set); };
                    btnContainer.appendChild(galBtn);
                }
            }
            grid.appendChild(card);
        });
        container.appendChild(grid);
    });
    show('customizerOptionSets');
}

function handleOptionClick(opt, set) {
    const floorData = wizardSteps[currentStepIndex];
    const isElevation = floorData.Name.toLowerCase().includes('elevation') || floorData.Name.toLowerCase().includes('exterior');

    if (!state.customizerSelections[set.id]) state.customizerSelections[set.id] = [];
    const isSelected = state.customizerSelections[set.id].includes(opt.id);

    if (isElevation) {
        if (!isSelected) {
            const floorSets = db.OptionSet.filter(os => os.BelongsToFloor === floorData.id);
            floorSets.forEach(fs => { state.customizerSelections[fs.id] = []; });
            state.customizerSelections[set.id] = [opt.id];
        }
    } else {
        const allowMultiple = set.allow_multiple_selections === true;

        if (isSelected) {
            state.customizerSelections[set.id] = state.customizerSelections[set.id].filter(id => id !== opt.id);
            if (state.customizerSelections['gallery_picks']) delete state.customizerSelections['gallery_picks'][opt.id];
        } else {
            if (!allowMultiple) {
                state.customizerSelections[set.id].forEach(existingId => {
                    if (state.customizerSelections['gallery_picks']) delete state.customizerSelections['gallery_picks'][existingId];
                });
                state.customizerSelections[set.id] = [opt.id]; 
            } else {
                // ROBUST GEAR CONFLICT CHECK: Uses getGearKey to ensure exact matching
                if (opt.Gear_X !== null && opt.Gear_Y !== null) {
                    const currentGearKey = getGearKey(opt.Gear_X, opt.Gear_Y);
                    
                    const conflictingIds = state.customizerSelections[set.id].filter(existingId => {
                        const existingOpt = db.Option.find(o => o.id === existingId);
                        if (!existingOpt || existingOpt.id === opt.id) return false;
                        if (existingOpt.Gear_X === null || existingOpt.Gear_Y === null) return false;
                        
                        return getGearKey(existingOpt.Gear_X, existingOpt.Gear_Y) === currentGearKey;
                    });
                    
                    conflictingIds.forEach(conflictId => {
                        state.customizerSelections[set.id] = state.customizerSelections[set.id].filter(id => id !== conflictId);
                        if (state.customizerSelections['gallery_picks']) delete state.customizerSelections['gallery_picks'][conflictId];
                    });
                }
                
                state.customizerSelections[set.id].push(opt.id); 
            }
        }
    }

    renderClientCanvas(floorData); 
    openSidebarMenu(currentActiveSidebarContext);
}

// --- GALLERY MODAL & LIGHTBOX ---

window.galleryLightboxImages = [];
window.galleryLightboxIndex = 0;

function openGalleryModal(opt, set) {
    let images = [];
    try {
        let parsed = typeof opt.gallery_images === 'string' ? JSON.parse(opt.gallery_images) : opt.gallery_images;
        if (typeof parsed === 'string') parsed = JSON.parse(parsed); 
        images = parsed || [];
    } catch(e) { 
        console.error("Gallery Parse Error", e); 
        return; 
    }

    const packages = {};
    images.forEach(img => {
        const imgUrl = img.url || img.Url || img.URL || img.image; 
        if (imgUrl && imgUrl.trim() !== '') {
            const groupName = img.group || img.Group || img.PackageName || 'Standard Style';
            if (!packages[groupName]) packages[groupName] = [];
            packages[groupName].push(imgUrl);
        }
    });

    if (Object.keys(packages).length === 0) {
        alert("No style images are currently configured for this option.");
        return;
    }

    getEl('modalTitle').innerHTML = `Style Gallery: ${opt.Name} <span id="closeGalBtn" style="float:right; cursor:pointer; font-size:24px; line-height:1;">&times;</span>`;
    setTimeout(() => { 
        const closeBtn = getEl('closeGalBtn');
        if(closeBtn) closeBtn.onclick = () => hide('modal'); 
    }, 50);

    window.galleryLightboxImages = []; 
    let html = `<div style="max-height: 70vh; overflow-y: auto; padding: 5px;">`;

    Object.keys(packages).forEach(groupName => {
        const pkgPhotos = packages[groupName];
        const isPkgSelected = state.customizerSelections['gallery_picks']?.[opt.id] === groupName;
        const isLayoutActive = (state.customizerSelections[set.id] || []).includes(opt.id);
        const displayAsSelected = isPkgSelected && isLayoutActive;

        html += `
            <div style="margin-bottom: 30px; border: 2px solid ${displayAsSelected ? 'var(--primary-color)' : '#eee'}; padding: 15px; border-radius: 12px; background: ${displayAsSelected ? '#fff9f4' : '#fff'};">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                    <h4 style="margin: 0; color: var(--headings-dark); font-family: var(--font-heading);">${groupName}</h4>
                    <button onclick="selectGalleryPackage('${opt.id}', '${set.id}', '${groupName}')" 
                            style="padding: 10px 20px; border-radius: 6px; border: none; background: var(--primary-color); color: white; font-weight: bold; cursor: pointer;">
                        ${displayAsSelected ? '✓ Selected' : (isLayoutActive ? 'Choose Style' : 'Select Layout & Style')}
                    </button>
                </div>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px;">
        `;

        pkgPhotos.forEach(url => {
            const globalIdx = window.galleryLightboxImages.length;
            window.galleryLightboxImages.push(url);
            html += `<img src="${url}" onclick="openLightbox(${globalIdx})" style="width: 100%; height: 120px; object-fit: cover; border-radius: 6px; border: 1px solid #eee; cursor: zoom-in;">`;
        });

        html += `</div></div>`;
    });

    html += `</div>`;
    
    if(!getEl('lightboxOverlay')) {
        const lb = document.createElement('div');
        lb.id = 'lightboxOverlay';
        lb.style.cssText = 'display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); z-index:10000; align-items:center; justify-content:center;';
        lb.innerHTML = `
            <span onclick="closeLightbox()" style="position:absolute; top:20px; right:30px; color:white; font-size:40px; cursor:pointer;">&times;</span>
            <button onclick="prevLightbox(event)" style="position:absolute; left:20px; background:none; border:none; color:white; font-size:50px; cursor:pointer;">&#10094;</button>
            <img id="lightboxImg" style="max-width:90%; max-height:90%; object-fit:contain;">
            <button onclick="nextLightbox(event)" style="position:absolute; right:20px; background:none; border:none; color:white; font-size:50px; cursor:pointer;">&#10095;</button>
        `;
        document.body.appendChild(lb);
    }

    getEl('modalForm').innerHTML = html;
    const saveBtn = getEl('modalSave');
    saveBtn.textContent = 'Finish Selection';
    saveBtn.onclick = () => hide('modal');
    getEl('modalCancel').style.display = 'none';
    show('modal');
}

window.selectGalleryPackage = function(optId, setId, groupName) {
    const floorData = wizardSteps[currentStepIndex];
    const set = db.OptionSet.find(s => s.id == setId);
    const opt = db.Option.find(o => o.id == optId);
    const allowMultiple = set && set.allow_multiple_selections === true;

    if (!state.customizerSelections[setId]) state.customizerSelections[setId] = [];
    
    if (!allowMultiple) {
        state.customizerSelections[setId].forEach(existingId => {
            if (existingId != optId && state.customizerSelections['gallery_picks']) {
                delete state.customizerSelections['gallery_picks'][existingId];
            }
        });
        state.customizerSelections[setId] = [parseInt(optId)]; 
    } else {
        // ROBUST GEAR CONFLICT CHECK FOR MODAL SELECTIONS
        if (opt && opt.Gear_X !== null && opt.Gear_Y !== null) {
            const currentGearKey = getGearKey(opt.Gear_X, opt.Gear_Y);
            
            const conflictingIds = state.customizerSelections[setId].filter(existingId => {
                const existingOpt = db.Option.find(o => o.id === existingId);
                if (!existingOpt || existingOpt.id === parseInt(optId)) return false;
                if (existingOpt.Gear_X === null || existingOpt.Gear_Y === null) return false;
                
                return getGearKey(existingOpt.Gear_X, existingOpt.Gear_Y) === currentGearKey;
            });
            
            conflictingIds.forEach(conflictId => {
                state.customizerSelections[setId] = state.customizerSelections[setId].filter(id => id !== conflictId);
                if (state.customizerSelections['gallery_picks']) delete state.customizerSelections['gallery_picks'][conflictId];
            });
        }

        if (!state.customizerSelections[setId].includes(parseInt(optId))) {
            state.customizerSelections[setId].push(parseInt(optId)); 
        }
    }
    
    if (!state.customizerSelections['gallery_picks']) state.customizerSelections['gallery_picks'] = {};
    state.customizerSelections['gallery_picks'][optId] = groupName;

    renderClientCanvas(floorData); 
    hide('modal');
    openSidebarMenu(currentActiveSidebarContext);
};

window.openLightbox = function(index) {
    window.galleryLightboxIndex = index;
    getEl('lightboxImg').src = window.galleryLightboxImages[index];
    getEl('lightboxOverlay').style.display = 'flex';
};
window.closeLightbox = function() { getEl('lightboxOverlay').style.display = 'none'; };
window.nextLightbox = function(e) { 
    e.stopPropagation(); 
    window.galleryLightboxIndex = (window.galleryLightboxIndex + 1) % window.galleryLightboxImages.length; 
    getEl('lightboxImg').src = window.galleryLightboxImages[window.galleryLightboxIndex]; 
};
window.prevLightbox = function(e) { 
    e.stopPropagation(); 
    window.galleryLightboxIndex = (window.galleryLightboxIndex - 1 + window.galleryLightboxImages.length) % window.galleryLightboxImages.length; 
    getEl('lightboxImg').src = window.galleryLightboxImages[window.galleryLightboxIndex]; 
};

// --- REVIEW AND PDF LOGIC ---

function renderReviewPage() {
    const container = getEl('reviewContent');
    container.innerHTML = '';

    let hasAnySelections = false;

    wizardSteps.filter(step => !step.isReview).forEach(floor => {
        const floorSets = db.OptionSet.filter(os => os.BelongsToFloor === floor.id).sort((a,b) => a.position - b.position);
        
        let floorHtml = `
            <div class="review-floor-section" style="margin-bottom: 50px;">
                <h3 style="border-bottom: 2px solid var(--primary-color); padding-bottom: 10px; margin-bottom: 20px; color: var(--headings-dark); font-size: 1.5rem;">
                    ${floor.Name}
                </h3>
        `;
        
        const snapshotUrl = state.floorSnapshots && state.floorSnapshots[floor.id];
        if (snapshotUrl) {
            floorHtml += `
                <div style="margin-bottom: 40px; width: 100%; display: flex; justify-content: center;">
                    <img src="${snapshotUrl}" alt="${floor.Name} Render" style="width: 60%; height: auto; object-fit: contain; filter: drop-shadow(0px 10px 15px rgba(0,0,0,0.1));">
                </div>
            `;
        }

        floorHtml += `<div class="review-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 20px;">`;
        
        let hasFloorSelections = false;

        floorSets.forEach(set => {
            const selectedIds = state.customizerSelections[set.id] || [];
            const idsArray = Array.isArray(selectedIds) ? selectedIds : [selectedIds];
            
            if (idsArray.length > 0) {
                idsArray.forEach(optId => {
                    const opt = db.Option.find(o => o.id === optId);
                    if (opt) {
                        hasFloorSelections = true;
                        hasAnySelections = true;
                        
                        floorHtml += `
                            <div class="review-card" style="border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; background: #fff; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
                                <div style="height: 180px; display: flex; align-items: center; justify-content: center; background: #fdfdfd; border-bottom: 1px solid var(--border-color);">
                                    <img src="${opt.Thumbnail}" style="max-width: 100%; max-height: 100%; object-fit: contain; padding: 10px;">
                                </div>
                                <div style="padding: 10px; line-height: 1.3;">
                                    <div style="font-size: 0.7rem; color: var(--primary-color); text-transform: uppercase; margin-bottom: 2px; font-weight: bold;">
                                        ${set.Name}
                                    </div>
                                    <div style="font-weight: 600; color: var(--headings-dark); font-size: 0.9rem;">
                                        ${opt.Name}
                                    </div>
                                    ${opt.code ? `<div style="font-size: 0.7rem; color: #888; margin-top: 3px;">Code: ${opt.code}</div>` : ''}
                                </div>
                            </div>
                        `;
                    }
                });
            }
        });

        floorHtml += `</div></div>`;
        
        if (hasFloorSelections || snapshotUrl) {
            container.innerHTML += floorHtml;
        }
    });

    if (!hasAnySelections && (!state.floorSnapshots || Object.keys(state.floorSnapshots).length === 0)) {
        container.innerHTML = `
            <div style="text-align: center; padding: 60px 20px; color: #666;">
                <span class="material-symbols-outlined" style="font-size: 48px; color: #ccc; margin-bottom: 15px; display: block;">inventory_2</span>
                <h3>No Selections Made</h3>
                <p>You haven't selected any custom upgrades yet. Click 'Back to Customizer' to explore your options.</p>
            </div>
        `;
    }
}

async function getBase64ImageFromUrl(imageUrl) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            
            // Limit massive gallery photos to a reasonable max dimension for PDFs
            const maxDim = 1200; 
            if (width > maxDim || height > maxDim) {
                if (width > height) {
                    height = Math.round((height / width) * maxDim);
                    width = maxDim;
                } else {
                    width = Math.round((width / height) * maxDim);
                    height = maxDim;
                }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            
            // Fill white background to prevent transparent areas turning black in JPEG
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, width, height);
            
            // Export as JPEG with 75% quality (Massive file size reduction)
            resolve(canvas.toDataURL('image/jpeg', 0.75));
        };
        img.onerror = () => resolve(null);
        img.src = imageUrl;
    });
}

function openLeadCaptureModal() {
    getEl('modalTitle').textContent = 'Where should we send your brochure?';
    getEl('modalForm').innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 15px; margin-top: 15px;">
            <p style="color: #666; font-size: 0.9rem; margin-bottom: 5px;">Please enter your details to generate your custom home brochure.</p>
            <input type="text" id="pdfClientName" placeholder="Full Name (Required)" style="padding: 12px; border: 1px solid #ccc; border-radius: 4px; font-family: var(--font-body);" required>
            <input type="email" id="pdfClientEmail" placeholder="Email Address (Required)" style="padding: 12px; border: 1px solid #ccc; border-radius: 4px; font-family: var(--font-body);" required>
            <input type="tel" id="pdfClientPhone" placeholder="Phone Number (Optional)" style="padding: 12px; border: 1px solid #ccc; border-radius: 4px; font-family: var(--font-body);">
        </div>
    `;
    
    const saveBtn = getEl('modalSave');
    saveBtn.textContent = 'Download Brochure';
    saveBtn.classList.remove('hidden');
    
    const newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
    
    getEl('modalCancel').onclick = () => hide('modal');
    
    newSaveBtn.addEventListener('click', async () => {
        const nameInput = getEl('pdfClientName');
        const emailInput = getEl('pdfClientEmail');
        const phoneInput = getEl('pdfClientPhone');

        const name = nameInput.value.trim();
        const email = emailInput.value.trim();
        const phone = phoneInput.value.trim();

        if (!name || !email) {
            alert("Please provide your Name and Email to download your custom brochure.");
            nameInput.style.borderColor = name ? '#ccc' : 'red';
            emailInput.style.borderColor = email ? '#ccc' : 'red';
            return; 
        }

        nameInput.style.borderColor = '#ccc';
        emailInput.style.borderColor = '#ccc';

        newSaveBtn.textContent = 'Preparing PDF...';
        newSaveBtn.disabled = true;

        try {
            const currentModel = db.ModelHome.find(m => m.id === state.currentModelHomeId);
            const modelName = currentModel ? currentModel.Name : 'Custom Home';

            // --- BUILD HUMAN-READABLE HTML SELECTIONS ---
            let formattedSelections = '<ul style="margin:0; padding-left:20px; font-family: Arial, sans-serif; font-size: 14px; color: #333;">';
            let hasSelections = false;

            Object.keys(state.customizerSelections).forEach(setId => {
                if (setId === 'gallery_picks') return; // Skip the gallery picks bucket
                
                const setRef = db.OptionSet.find(s => s.id == setId);
                if (!setRef) return;

                const selectedOptIds = state.customizerSelections[setId] || [];
                const idsArray = Array.isArray(selectedOptIds) ? selectedOptIds : [selectedOptIds];
                
                if (idsArray.length > 0) {
                    hasSelections = true;
                    formattedSelections += `<li style="margin-bottom: 10px;"><strong>${setRef.Name}:</strong><ul style="margin-top: 4px;">`;
                    
                    idsArray.forEach(optId => {
                        const optRef = db.Option.find(o => o.id == optId);
                        if (optRef) {
                            const codeText = optRef.code ? ` <span style="color:#888; font-size:12px;">(${optRef.code})</span>` : '';
                            const stylePick = state.customizerSelections['gallery_picks']?.[optId];
                            const styleText = stylePick ? ` <br><em style="color:#ec8d44; font-size:12px;">↳ Style: ${stylePick}</em>` : '';
                            
                            formattedSelections += `<li style="margin-bottom: 4px;">${optRef.Name}${codeText}${styleText}</li>`;
                        }
                    });
                    
                    formattedSelections += `</ul></li>`;
                }
            });
            formattedSelections += '</ul>';

            if (!hasSelections) {
                formattedSelections = '<p style="color: #666; font-style: italic;">No custom upgrades selected.</p>';
            }
            // ---------------------------------------------

            const { error } = await supabase.from('Leads').insert([{
                client_name: name,
                client_email: email,
                client_phone: phone,
                model_name: modelName,
                selections_json: state.customizerSelections,
                selections_text: formattedSelections // Saves the beautiful HTML string!
            }]);

            if (error) throw error;

            hide('modal');
            generatePDFBrochure();

        } catch (err) {
            console.error("Error saving lead:", err);
            alert("There was an issue processing your request. Please try again.");
            newSaveBtn.textContent = 'Download Brochure';
            newSaveBtn.disabled = false;
        }
    });
    
    show('modal');
}

async function generatePDFBrochure() {
    const btn = getEl('exportBrochureBtn');
    const originalText = btn.textContent;
    btn.textContent = 'Preparing PDF...';
    btn.disabled = true;

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        
        const currentModel = db.ModelHome.find(m => m.id === state.currentModelHomeId);
        const modelName = currentModel ? currentModel.Name : 'Custom Home';
        const clientName = getEl('pdfClientName') ? getEl('pdfClientName').value.trim() : '';
        const clientEmail = getEl('pdfClientEmail') ? getEl('pdfClientEmail').value.trim() : '';
        const clientPhone = getEl('pdfClientPhone') ? getEl('pdfClientPhone').value.trim() : '';
        const dateString = new Date().toLocaleDateString();

        // COVER PAGE
        doc.setFont('helvetica', 'bold').setFontSize(28).setTextColor(30, 30, 30);
        doc.text('Elevate Design + Build', pageWidth / 2, 80, { align: 'center' });
        doc.setFont('helvetica', 'normal').setFontSize(18).setTextColor(236, 141, 68); 
        doc.text(`Model: ${modelName}`, pageWidth / 2, 100, { align: 'center' });
        doc.setDrawColor(200, 200, 200).line(40, 110, pageWidth - 40, 110);

        doc.setFontSize(14).setTextColor(100, 100, 100);
        let currentY = 130;
        if (clientName) { doc.text(`Prepared for: ${clientName}`, pageWidth / 2, currentY, { align: 'center' }); currentY += 10; }
        if (clientEmail) { doc.text(clientEmail, pageWidth / 2, currentY, { align: 'center' }); currentY += 10; }
        if (clientPhone) { doc.text(clientPhone, pageWidth / 2, currentY, { align: 'center' }); currentY += 10; }
        
        currentY += 5;
        doc.text(`Date: ${dateString}`, pageWidth / 2, currentY, { align: 'center' });

        // FLOORS
        for (const floor of wizardSteps.filter(step => !step.isReview)) {
            const isElevation = floor.Name.toLowerCase().includes('elevation') || floor.Name.toLowerCase().includes('exterior');
            const snapshotUrl = state.floorSnapshots && state.floorSnapshots[floor.id];
            const floorSets = db.OptionSet.filter(os => os.BelongsToFloor === floor.id).sort((a,b) => a.position - b.position);
            
            let selectedOptions = [];
            floorSets.forEach(set => {
                const selectedIds = state.customizerSelections[set.id] || [];
                (Array.isArray(selectedIds) ? selectedIds : [selectedIds]).forEach(optId => {
                    const opt = db.Option.find(o => o.id === optId);
                    if (opt) selectedOptions.push({ set, opt });
                });
            });

            // RENDER PAGE
            if (snapshotUrl || selectedOptions.length > 0) {
                doc.addPage();
                doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(236, 141, 68);
                doc.text(floor.Name, 20, 25);
                doc.setDrawColor(200, 200, 200).line(20, 30, pageWidth - 20, 30);

                let pdfImgHeight = 0;
                if (snapshotUrl) {
                    const imgProps = doc.getImageProperties(snapshotUrl);
                    const pdfImgWidth = pageWidth - 40; 
                    pdfImgHeight = (imgProps.height * pdfImgWidth) / imgProps.width;
                    doc.addImage(snapshotUrl, 'JPEG', 20, 40, pdfImgWidth, pdfImgHeight);
                }

                if (isElevation && selectedOptions.length > 0) {
                    const elevOpt = selectedOptions[0]; 
                    doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(30, 30, 30);
                    doc.text(`Selected Elevation: ${elevOpt.opt.Name}`, 20, 40 + pdfImgHeight + 15);
                    
                    if (elevOpt.opt.code) {
                        doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(100, 100, 100);
                        doc.text(`Plan Code: ${elevOpt.opt.code}`, 20, 40 + pdfImgHeight + 22);
                    }
                    selectedOptions = []; 
                }
            }

            // INTERIOR OPTIONS
            if (selectedOptions.length > 0) {
                doc.addPage();
                doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(30, 30, 30);
                doc.text(`${floor.Name} Upgrades`, 20, 25);
                doc.line(20, 30, pageWidth - 20, 30);

                let yPos = 40;
                for (const item of selectedOptions) {
                    if (yPos > 240) { doc.addPage(); yPos = 20; }

                    let base64Thumb = null;
                    if (item.opt.Thumbnail && item.opt.Thumbnail !== 'null') {
                        base64Thumb = await getBase64ImageFromUrl(item.opt.Thumbnail);
                    }

                    if (base64Thumb) {
                        const thumbProps = doc.getImageProperties(base64Thumb);
                        const thumbWidth = 30; 
                        const thumbHeight = (thumbProps.height * thumbWidth) / thumbProps.width; 
                        doc.addImage(base64Thumb, 'JPEG', 20, yPos, thumbWidth, thumbHeight);
                    }

                    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(236, 141, 68); 
                    doc.text(item.set.Name.toUpperCase(), 55, yPos + 10);
                    
                    doc.setFont('helvetica', 'normal').setFontSize(14).setTextColor(30, 30, 30); 
                    doc.text(item.opt.Name, 55, yPos + 18);

                    if (item.opt.code) {
                        doc.setFont('helvetica', 'italic').setFontSize(10).setTextColor(120, 120, 120);
                        doc.text(`Code: ${item.opt.code}`, 55, yPos + 24);
                    }

                    yPos += 35; 

                    const galleryPicks = state.customizerSelections['gallery_picks'] || {};
                    if (galleryPicks[item.opt.id]) {
                        const pkgName = galleryPicks[item.opt.id];
                        let images = [];
                        try {
                            const raw = typeof item.opt.gallery_images === 'string' ? JSON.parse(item.opt.gallery_images) : item.opt.gallery_images;
                            
                            // VETTED FIX: Safely match groups in the PDF exactly like we did in the Modal UI
                            images = raw.filter(img => {
                                const gName = img.group || img.Group || img.PackageName || 'Standard Style';
                                return gName === pkgName;
                            });
                        } catch(e) {}

                        for (const imgData of images) {
                            if (yPos > 220) { doc.addPage(); yPos = 20; }
                            const imgUrl = imgData.url || imgData.Url || imgData.URL || imgData.image;
                            const b64 = await getBase64ImageFromUrl(imgUrl);
                            if (b64) {
                                doc.addImage(b64, 'JPEG', 30, yPos, 80, 50); 
                                doc.setFont('helvetica', 'italic').setFontSize(10).setTextColor(100,100,100);
                                doc.text(`Selected Style: ${pkgName}`, 30, yPos + 55);
                                yPos += 65;
                            }
                        }
                    }
                    yPos += 5; 
                }
            }
        }

        const saveName = clientName ? `${clientName.replace(/\s+/g, '_')}_Brochure.pdf` : `${modelName}_Brochure.pdf`;
        doc.save(saveName);

    } catch (err) {
        console.error("PDF generation failed:", err);
        alert("There was an error generating your PDF brochure.");
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

// --- EVENT LISTENERS ---
getEl('logoLink').addEventListener('click', (e) => {
    e.preventDefault();
    hide('wizardPage');
    hide('reviewPage');
    show('landingPage');
});

getEl('wizardNextBtn').addEventListener('click', () => {
    const currentStepData = wizardSteps[currentStepIndex];
    if (!currentStepData.isReview) {
        state.floorSnapshots = state.floorSnapshots || {};
        state.floorSnapshots[currentStepData.id] = captureCanvasSnapshot();
    }

    if (currentStepIndex < wizardSteps.length - 1) {
        currentStepIndex++;
        loadWizardStep();
    }
});

getEl('wizardBackBtn').addEventListener('click', () => {
    const currentStepData = wizardSteps[currentStepIndex];
    if (!currentStepData.isReview) {
        state.floorSnapshots = state.floorSnapshots || {};
        state.floorSnapshots[currentStepData.id] = captureCanvasSnapshot();
    }

    if (currentStepIndex > 0) {
        currentStepIndex--;
        loadWizardStep();
    }
});

getEl('reviewBackBtn').addEventListener('click', () => {
    hide('reviewPage');
    show('wizardPage');
    currentStepIndex--; 
    loadWizardStep();
});

// Close modal when clicking dark background
window.addEventListener('click', (event) => {
    if (event.target === getEl('modal')) hide('modal');
    if (event.target === getEl('lightboxOverlay')) window.closeLightbox();
});

getEl('exportBrochureBtn').addEventListener('click', openLeadCaptureModal);

// --- ZOOM LOGIC ---
function handleClientZoom(factor) {
    if (!clientCanvas) return;
    let zoom = clientCanvas.getZoom() * factor;
    if (zoom > 5) zoom = 5;
    if (zoom < 0.2) zoom = 0.2;
    // Zoom perfectly into the center of the screen
    const center = new fabric.Point(clientCanvas.width / 2, clientCanvas.height / 2);
    clientCanvas.zoomToPoint(center, zoom);
}

// Safely attach to the buttons (checks if they exist on the page first)
const zoomInBtn = getEl('zoomInBtn');
if (zoomInBtn) zoomInBtn.addEventListener('click', () => handleClientZoom(1.2));

const zoomOutBtn = getEl('zoomOutBtn');
if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => handleClientZoom(0.8));

const zoomResetBtn = getEl('zoomResetBtn');
if (zoomResetBtn) zoomResetBtn.addEventListener('click', () => {
    if (!clientCanvas) return;
    clientCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
});

initializeClientApp();