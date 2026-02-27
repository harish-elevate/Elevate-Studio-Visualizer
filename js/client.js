import { state, db, loadDataFromSupabase } from './state.js';
import { supabase } from './supabaseClient.js';

// --- DOM UTILITIES ---
const getEl = (id) => document.getElementById(id);
const hide = (id) => getEl(id).classList.add('hidden');
const show = (id) => getEl(id).classList.remove('hidden');

// --- WIZARD STATE ---
let wizardSteps = []; // Will hold the dynamically sorted floors + review step
let currentStepIndex = 0;

// --- INITIALIZATION ---
async function initializeClientApp() {
    // Show loader
    getEl('globalLoader').classList.remove('hidden');
    
    // Fetch all data from Supabase
    await loadDataFromSupabase();
    
    // Render the landing page grid
    renderLandingPage();
    
    // Hide loader
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
        card.innerHTML = `
            <img src="${model.CoverImage}" alt="${model.Name}" class="model-home-card-image">
            <div class="model-home-card-name">${model.Name}</div>
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
    
    // 1. Gather all floors for this model
    const floors = db.Floor.filter(f => f.BelongsToModel === modelId);
    
    // 2. Sort them: Elevations first, then the rest by ID (or name)
    wizardSteps = floors.sort((a, b) => {
        const aIsElev = a.Name.toLowerCase().includes('elevation') || a.Name.toLowerCase().includes('exterior');
        const bIsElev = b.Name.toLowerCase().includes('elevation') || b.Name.toLowerCase().includes('exterior');
        if (aIsElev && !bIsElev) return -1;
        if (!aIsElev && bIsElev) return 1;
        return a.id - b.id;
    });

    // 3. Add the final "Review" step to the array
    wizardSteps.push({ isReview: true, Name: 'Review & Publish' });

    // 4. Set up the UI
    currentStepIndex = 0;
    buildWizardProgressBar();
    
    // Hide landing page, show wizard
    hide('landingPage');
    show('wizardPage');
    
    // Load the first step
    loadWizardStep();
}

function buildWizardProgressBar() {
    const bar = document.querySelector('.wizard-progress-bar');
    bar.innerHTML = ''; // Clear hardcoded HTML
    
    wizardSteps.forEach((step, index) => {
        const stepEl = document.createElement('div');
        stepEl.className = 'wizard-step';
        stepEl.id = `step-indicator-${index}`;
        stepEl.textContent = `${index + 1}. ${step.Name}`;
        bar.appendChild(stepEl);
    });
}

let clientCanvas = null;
let lastRenderedFloorId = null; // Tracks the floor to prevent background flashing
let currentActiveSidebarContext = null; // Tracks the currently open menu (either an Array or a Coordinate String)

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

        // 1. Mouse Wheel Zoom
        clientCanvas.on('mouse:wheel', function(opt) {
            var delta = opt.e.deltaY;
            var zoom = clientCanvas.getZoom();
            zoom *= 0.999 ** delta;
            if (zoom > 5) zoom = 5; // Max zoom
            if (zoom < 0.2) zoom = 0.2; // Min zoom
            clientCanvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
            opt.e.preventDefault();
            opt.e.stopPropagation();
        });

        // 2. Click and Drag to Pan
        let isDragging = false;
        let lastPosX, lastPosY;

        clientCanvas.on('mouse:down', function(opt) {
            // Only pan if we clicked the background, not a gear!
            if (opt.target && opt.target.data && opt.target.data.isGear) return;
            
            const evt = opt.e;
            isDragging = true;
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
                const vpt = clientCanvas.viewportTransform;
                vpt[4] += currX - lastPosX;
                vpt[5] += currY - lastPosY;
                clientCanvas.requestRenderAll();
                lastPosX = currX;
                lastPosY = currY;
            }
        });

        clientCanvas.on('mouse:up', function() {
            if (isDragging) {
                clientCanvas.setViewportTransform(clientCanvas.viewportTransform);
                isDragging = false;
                clientCanvas.setCursor('grab');
            }
        });

        // 3. Touch Pinch Zoom (For Tablets/Phones)
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

    // --- TRUE CANVAS DIFFING ---
    // If we are on the exact same floor and base image, trigger the smart diffing function!
    if (lastRenderedFloorId === floorData.id && clientCanvas.lastImageUrl === imageUrl) {
        diffAndRenderCanvas(floorData, clientCanvas.bgMetrics);
        return;
    }

    // Otherwise, it's a new floor. Do a full wipe.
    lastRenderedFloorId = floorData.id;
    clientCanvas.lastImageUrl = imageUrl;
    
    // FIX: Reset the camera zoom and pan back to default before drawing the new floor!
    clientCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]); 
    
    clientCanvas.clear();

    if (!imageUrl) {
        clientCanvas.setBackgroundColor('#ffffff', clientCanvas.renderAll.bind(clientCanvas));
        const text = new fabric.Text(isElevation ? 'Select an option to preview...' : 'No Floor Plan Available', {
            fontSize: 20, fill: '#999', originX: 'center', originY: 'center',
            left: canvasWidth / 2, top: canvasHeight / 2, selectable: false
        });
        clientCanvas.add(text);
        clientCanvas.bgMetrics = { offsetX: 0, offsetY: 0, width: canvasWidth, height: canvasHeight };
        
        // FIX: Ensure gears NEVER render on elevations
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
            // FIX: Ensure gears NEVER render on elevations
            if (!isElevation) renderGearIcons(floorData, clientCanvas.bgMetrics);
        });
    };
    image.onerror = () => {
        clientCanvas.setBackgroundColor('#f0f0f0', clientCanvas.renderAll.bind(clientCanvas));
    };
    image.src = imageUrl;
}

// --- NEW FUNCTION: Smart Layer Updating ---
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
    
    // 2. Add NEW overlays that were just selected
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

                    // TAG IT: We attach the ID and layerOrder so we can track it
                    img.set({
                        left: left, top: top, scaleX: scaleX, scaleY: scaleY,
                        selectable: false, evented: false,
                        data: { isOverlay: true, optionId: option.id, layerOrder: option.layer_order || 0 }
                    });
                    clientCanvas.add(img);
                    resolve();
                }, { crossOrigin: 'anonymous' });
            });
        }
    }
    
    // 3. Keep the visual layers perfectly sorted
    clientCanvas._objects.sort((a, b) => {
        const orderA = a.data?.layerOrder ?? 0;
        const orderB = b.data?.layerOrder ?? 0;
        return orderA - orderB;
    });

    // 4. Quickly redraw the gears so they reflect prerequisite changes and stay on top
    clientCanvas.getObjects().forEach(obj => {
        if (obj.data && obj.data.isGear) clientCanvas.remove(obj);
    });
    
    if (!isElevation) {
        renderGearIcons(floorData, bgMetrics);
    } else {
        clientCanvas.renderAll();
    }
}

async function renderActiveOverlays(floorData, bgMetrics) {
    const isElevation = floorData.Name.toLowerCase().includes('elevation') || floorData.Name.toLowerCase().includes('exterior');
    const optionSets = db.OptionSet.filter(os => os.BelongsToFloor === floorData.id);
    const selectedIds = Object.values(state.customizerSelections).flat();
    
    const optionsToDraw = db.Option
        .filter(opt => optionSets.map(s => s.id).includes(opt.BelongsToOptionSet) && selectedIds.includes(opt.id))
        .sort((a, b) => (a.layer_order ?? 0) - (b.layer_order ?? 0));

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

                // TAG IT: Initial load tags the objects for future diffing
                img.set({
                    left: left, top: top, scaleX: scaleX, scaleY: scaleY,
                    selectable: false, evented: false,
                    data: { isOverlay: true, optionId: option.id, layerOrder: option.layer_order || 0 }
                });
                clientCanvas.add(img);
                resolve();
            }, { crossOrigin: 'anonymous' });
        });
    }
}

// Helper to guarantee math matches perfectly when stacking gears
const getGearKey = (x, y) => `${Number(x).toFixed(4)},${Number(y).toFixed(4)}`;

function renderGearIcons(floorData, bgMetrics) {
    const gearIconUrl = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="%23ec8d44" stroke="white" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';

    const floorSets = db.OptionSet.filter(os => os.BelongsToFloor === floorData.id);
    const allSelectedIds = Object.values(state.customizerSelections).flat();
    const gearMap = new Map();

    // 1. Map Set-Level Gears
    floorSets.filter(os => (!os.icon_mode || os.icon_mode === 'set_level') && os.Gear_X !== null).forEach(os => {
        const key = getGearKey(os.Gear_X, os.Gear_Y);
        if (!gearMap.has(key)) gearMap.set(key, { x: os.Gear_X, y: os.Gear_Y }); // Store raw coordinates
    });

    // 2. Map Option-Level Gears (with prerequisites check)
    const floorOptions = db.Option.filter(o => floorSets.map(s => s.id).includes(o.BelongsToOptionSet) && o.Gear_X !== null);
    
    floorOptions.forEach(opt => {
        if (opt.requirements && opt.requirements.length > 0) {
            const hasRequirement = opt.requirements.some(reqId => allSelectedIds.includes(reqId));
            if (!hasRequirement) return; 
        }
        const parentSet = floorSets.find(s => s.id === opt.BelongsToOptionSet);
        if (parentSet && parentSet.icon_mode === 'option_level') {
            const key = getGearKey(opt.Gear_X, opt.Gear_Y);
            if (!gearMap.has(key)) gearMap.set(key, { x: opt.Gear_X, y: opt.Gear_Y });
        }
    });

    // Render one gear per unique coordinate
    gearMap.forEach((coords, keyString) => {
        fabric.Image.fromURL(gearIconUrl, (img) => {
            const left = bgMetrics.offsetX + (coords.x / 100) * bgMetrics.width - (img.width/2);
            const top = bgMetrics.offsetY + (coords.y / 100) * bgMetrics.height - (img.height/2);

            img.set({
                left: left, top: top,
                selectable: false, evented: true, hoverCursor: 'pointer',
                shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.5)', blur: 5, offsetX: 2, offsetY: 2 }),
                data: { isGear: true, layerOrder: 9999 }
            });
            
            animateGear(img);
            
            // Pass the exact coordinate string to the sidebar opener
            img.on('mousedown', () => openSidebarMenu(keyString));
            clientCanvas.add(img);
        });
    });
}

// --- CANVAS SNAPSHOT LOGIC ---
// --- CANVAS SNAPSHOT LOGIC ---
// --- CANVAS SNAPSHOT LOGIC ---
function captureCanvasSnapshot() {
    if (!clientCanvas || !clientCanvas.bgMetrics) return null;

    // 1. Save their current zoom & pan so we don't disrupt their view
    const originalVpt = clientCanvas.viewportTransform.slice();
    
    // 2. Reset zoom/pan to default so our coordinates calculate perfectly
    clientCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

    // 3. Find and hide gears (and any placeholder text)
    const gears = clientCanvas.getObjects().filter(o => o.data && o.data.isGear);
    const texts = clientCanvas.getObjects().filter(o => o.type === 'text');
    
    gears.forEach(g => g.set({ opacity: 0 }));
    texts.forEach(t => t.set({ opacity: 0 }));
    clientCanvas.renderAll();

    // 4. FIX: Set the initial crop box to the exact size of the Base Floor Plan
    let minX = clientCanvas.bgMetrics.offsetX;
    let minY = clientCanvas.bgMetrics.offsetY;
    let maxX = minX + clientCanvas.bgMetrics.width;
    let maxY = minY + clientCanvas.bgMetrics.height;
    
    // 5. Expand the crop box ONLY if an overlay stretches beyond the base plan
    const visibleObjects = clientCanvas.getObjects().filter(o => o.opacity !== 0 && o.data && o.data.isOverlay);
    visibleObjects.forEach(obj => {
        const bound = obj.getBoundingRect();
        if (bound.left < minX) minX = bound.left;
        if (bound.top < minY) minY = bound.top;
        if (bound.left + bound.width > maxX) maxX = bound.left + bound.width;
        if (bound.top + bound.height > maxY) maxY = bound.top + bound.height;
    });

    const padding = 10;

    // 6. Take a high-res snapshot cropped to our new, guaranteed-to-fit box
    const dataUrl = clientCanvas.toDataURL({ 
        format: 'png', 
        left: minX - padding,
        top: minY - padding,
        width: (maxX - minX) + (padding * 2),
        height: (maxY - minY) + (padding * 2),
        multiplier: 2 // Keeps it crisp for the PDF
    });

    // 7. Restore the gears, text, and the user's zoom/pan state
    gears.forEach(g => g.set({ opacity: 1 }));
    texts.forEach(t => t.set({ opacity: 1 }));
    clientCanvas.setViewportTransform(originalVpt);
    clientCanvas.renderAll();

    return dataUrl;
}

function animateGear(img) {
    // Simple pulse effect so the user knows it is interactive
    img.animate('opacity', 0.6, {
        duration: 1000,
        onChange: clientCanvas.renderAll.bind(clientCanvas),
        onComplete: function() {
            img.animate('opacity', 1, {
                duration: 1000,
                onChange: clientCanvas.renderAll.bind(clientCanvas),
                onComplete: () => animateGear(img)
            });
        }
    });
}

function openSidebarMenu(context) {
    currentActiveSidebarContext = context;
    
    let targets = [];
    const allSelectedIds = Object.values(state.customizerSelections).flat();

    if (Array.isArray(context)) {
        targets = context;
    } else if (typeof context === 'string') {
        const floorData = wizardSteps[currentStepIndex];
        const floorSets = db.OptionSet.filter(os => os.BelongsToFloor === floorData.id);

        floorSets.filter(os => (!os.icon_mode || os.icon_mode === 'set_level') && os.Gear_X !== null).forEach(os => {
            if (getGearKey(os.Gear_X, os.Gear_Y) === context) {
                targets.push({ id: os.id, type: 'OptionSet' });
            }
        });

        const floorOptions = db.Option.filter(o => floorSets.map(s => s.id).includes(o.BelongsToOptionSet) && o.Gear_X !== null);
        floorOptions.forEach(opt => {
            if (opt.requirements && opt.requirements.length > 0) {
                const hasRequirement = opt.requirements.some(reqId => allSelectedIds.includes(reqId));
                if (!hasRequirement) return; 
            }
            const parentSet = floorSets.find(s => s.id === opt.BelongsToOptionSet);
            if (parentSet && parentSet.icon_mode === 'option_level') {
                if (getGearKey(opt.Gear_X, opt.Gear_Y) === context) {
                    targets.push({ id: opt.id, type: 'Option' });
                }
            }
        });
    }

    if (targets.length === 0) return;

    hide('sidebarDefaultMessage');
    const container = getEl('customizerOptionSets');
    container.innerHTML = '';
    
    const renderData = {}; 

    targets.forEach(target => {
        if (target.type === 'OptionSet') {
            const set = db.OptionSet.find(s => s.id === target.id);
            if (!set) return;
            if (!renderData[set.id]) renderData[set.id] = { set, options: [] };
            
            const allOpts = db.Option.filter(o => o.BelongsToOptionSet === set.id).sort((a,b) => a.position - b.position);
            allOpts.forEach(o => {
                if (!renderData[set.id].options.some(existing => existing.id === o.id)) {
                    renderData[set.id].options.push(o);
                }
            });
        } else if (target.type === 'Option') {
            const opt = db.Option.find(o => o.id === target.id);
            if (!opt) return;
            const set = db.OptionSet.find(s => s.id === opt.BelongsToOptionSet);
            if (!set) return;

            if (!renderData[set.id]) renderData[set.id] = { set, options: [] };
            if (!renderData[set.id].options.some(existing => existing.id === opt.id)) {
                renderData[set.id].options.push(opt);
            }
        }
    });

    const sortedSetIds = Object.keys(renderData).sort((a,b) => renderData[a].set.position - renderData[b].set.position);

    sortedSetIds.forEach(setId => {
        const { set, options } = renderData[setId];
        
        const header = document.createElement('h3');
        header.textContent = options.length === 1 && targets.length === 1 && targets[0].type === 'Option' 
            ? 'Customize Upgrade' 
            : `Customize: ${set.Name}`;
            
        header.style.marginBottom = '15px';
        header.style.color = 'var(--primary-color)';
        header.style.borderBottom = '1px solid var(--border-color)';
        header.style.paddingBottom = '5px';
        container.appendChild(header);

        const grid = document.createElement('div');
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
        grid.style.gap = '15px';
        grid.style.marginBottom = '30px';

        options.forEach(opt => {
            let currentSelection = state.customizerSelections[set.id] || [];
            if (!Array.isArray(currentSelection)) currentSelection = [currentSelection];
            const isSelected = currentSelection.includes(opt.id);

            const card = document.createElement('div');
            card.className = `option-thumbnail-item ${isSelected ? 'selected' : ''}`;
            card.style.border = isSelected ? '2px solid var(--primary-color)' : '1px solid var(--border-color)';
            card.style.boxShadow = isSelected ? '0 0 0 2px var(--primary-color)' : 'none';
            card.style.borderRadius = '6px';
            card.style.cursor = 'pointer';
            card.style.overflow = 'hidden';
            card.style.backgroundColor = '#fff';

            // Fixed Proportions: Image gets 150px height, text is compressed to the bottom
            card.innerHTML = `
                <div style="height: 150px; display: flex; align-items: center; justify-content: center; background: #fdfdfd; border-bottom: 1px solid var(--border-color);">
                    <img src="${opt.Thumbnail}" alt="${opt.Name}" style="max-width: 100%; max-height: 100%; object-fit: contain; padding: 5px; display: block;">
                </div>
                <div style="padding: 8px 5px; font-size: 0.8rem; font-family: var(--font-heading); text-align: center; color: var(--headings-dark); font-weight: bold; line-height: 1.2;">
                    ${opt.Name}
                </div>
            `;

            card.addEventListener('click', () => handleOptionClick(opt, set));
            grid.appendChild(card);
        });
        container.appendChild(grid);
    });

    show('customizerOptionSets');
}

function handleOptionClick(option, optionSet) {
    let currentSelection = state.customizerSelections[optionSet.id] || [];
    if (!Array.isArray(currentSelection)) currentSelection = [currentSelection];

    const isCurrentlySelected = currentSelection.includes(option.id);

    if (isCurrentlySelected) {
        if (optionSet.allow_multiple_selections) {
            state.customizerSelections[optionSet.id] = currentSelection.filter(id => id !== option.id);
        } else {
            state.customizerSelections[optionSet.id] = [];
        }
    } else {
        if (optionSet.allow_multiple_selections) {
            if (!currentSelection.includes(option.id)) currentSelection.push(option.id);
            state.customizerSelections[optionSet.id] = currentSelection;
        } else {
            state.customizerSelections[optionSet.id] = [option.id];
        }
    }

    const currentStepData = wizardSteps[currentStepIndex];
    renderClientCanvas(currentStepData);

    // Refresh the sidebar maintaining the same grouped targets!
    openSidebarMenu(currentActiveSidebarContext);
}

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
                        
                        // Fixed Proportions for Review Page
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

// --- PDF GENERATION LOGIC ---
// --- HELPER TO LOAD IMAGES FOR PDF ---
async function getBase64ImageFromUrl(imageUrl) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => resolve(null);
        img.src = imageUrl;
    });
}

// --- NEW PDF GENERATION LOGIC ---
// --- NEW PDF GENERATION LOGIC ---
// --- PDF & MODAL LOGIC ---
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
    
    // Clear old listeners by replacing the button
    const newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
    
    getEl('modalCancel').onclick = () => hide('modal');
    
    // VALIDATION AND SAVING LOGIC
    newSaveBtn.addEventListener('click', async () => {
        const nameInput = getEl('pdfClientName');
        const emailInput = getEl('pdfClientEmail');
        const phoneInput = getEl('pdfClientPhone');

        const name = nameInput.value.trim();
        const email = emailInput.value.trim();
        const phone = phoneInput.value.trim();

        // 1. Validation: Block empty submissions and highlight red
        if (!name || !email) {
            alert("Please provide your Name and Email to download your custom brochure.");
            nameInput.style.borderColor = name ? '#ccc' : 'red';
            emailInput.style.borderColor = email ? '#ccc' : 'red';
            return; // Stops the function right here!
        }

        // Reset borders if they fixed the errors
        nameInput.style.borderColor = '#ccc';
        emailInput.style.borderColor = '#ccc';

        // 2. Visual feedback
        newSaveBtn.textContent = 'Preparing PDF...';
        newSaveBtn.disabled = true;

        // 3. Save to Supabase
        try {
            const currentModel = db.ModelHome.find(m => m.id === state.currentModelHomeId);
            const modelName = currentModel ? currentModel.Name : 'Custom Home';

            const { error } = await supabase.from('Leads').insert([{
                client_name: name,
                client_email: email,
                client_phone: phone,
                model_name: modelName,
                selections_json: state.customizerSelections
            }]);

            if (error) throw error;

            // 4. Success! Hide modal and generate PDF
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
    // We already changed the button in HTML, but we'll disable it while it loads
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
        
        // Grab inputs from the Modal
        const clientName = getEl('pdfClientName') ? getEl('pdfClientName').value.trim() : '';
        const clientEmail = getEl('pdfClientEmail') ? getEl('pdfClientEmail').value.trim() : '';
        const clientPhone = getEl('pdfClientPhone') ? getEl('pdfClientPhone').value.trim() : '';
        const dateString = new Date().toLocaleDateString();

        // PAGE 1: COVER PAGE
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(28);
        doc.setTextColor(30, 30, 30);
        doc.text('Elevate Design + Build', pageWidth / 2, 80, { align: 'center' });
        
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(18);
        doc.setTextColor(236, 141, 68); 
        doc.text(`Model: ${modelName}`, pageWidth / 2, 100, { align: 'center' });

        doc.setDrawColor(200, 200, 200);
        doc.line(40, 110, pageWidth - 40, 110);

        doc.setFontSize(14);
        doc.setTextColor(100, 100, 100);
        let currentY = 130;
        if (clientName) { doc.text(`Prepared for: ${clientName}`, pageWidth / 2, currentY, { align: 'center' }); currentY += 10; }
        if (clientEmail) { doc.text(clientEmail, pageWidth / 2, currentY, { align: 'center' }); currentY += 10; }
        if (clientPhone) { doc.text(clientPhone, pageWidth / 2, currentY, { align: 'center' }); currentY += 10; }
        
        currentY += 5;
        doc.text(`Date: ${dateString}`, pageWidth / 2, currentY, { align: 'center' });

        // LOOP THROUGH FLOORS 
        for (const floor of wizardSteps.filter(step => !step.isReview)) {
            const isElevation = floor.Name.toLowerCase().includes('elevation') || floor.Name.toLowerCase().includes('exterior');
            const snapshotUrl = state.floorSnapshots && state.floorSnapshots[floor.id];
            const floorSets = db.OptionSet.filter(os => os.BelongsToFloor === floor.id).sort((a,b) => a.position - b.position);
            
            let selectedOptions = [];
            floorSets.forEach(set => {
                const selectedIds = state.customizerSelections[set.id] || [];
                const idsArray = Array.isArray(selectedIds) ? selectedIds : [selectedIds];
                idsArray.forEach(optId => {
                    const opt = db.Option.find(o => o.id === optId);
                    if (opt) selectedOptions.push({ set, opt });
                });
            });

            // MAIN RENDER PAGE
            if (snapshotUrl || selectedOptions.length > 0) {
                doc.addPage();
                
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(20);
                doc.setTextColor(236, 141, 68);
                doc.text(floor.Name, 20, 25);
                doc.setDrawColor(200, 200, 200);
                doc.line(20, 30, pageWidth - 20, 30);

                let pdfImgHeight = 0;

                if (snapshotUrl) {
                    const imgProps = doc.getImageProperties(snapshotUrl);
                    const pdfImgWidth = pageWidth - 40; 
                    pdfImgHeight = (imgProps.height * pdfImgWidth) / imgProps.width;
                    doc.addImage(snapshotUrl, 'PNG', 20, 40, pdfImgWidth, pdfImgHeight);
                } else {
                    doc.setFontSize(12);
                    doc.setTextColor(150, 150, 150);
                    doc.text('No render available.', 20, 50);
                }

                if (isElevation && selectedOptions.length > 0) {
                    const elevOpt = selectedOptions[0]; 
                    let textY = 40 + pdfImgHeight + 15;
                    
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(14);
                    doc.setTextColor(30, 30, 30);
                    doc.text(`Selected: ${elevOpt.opt.Name}`, 20, textY);
                    
                    if (elevOpt.opt.code) {
                        doc.setFont('helvetica', 'normal');
                        doc.setFontSize(11);
                        doc.setTextColor(100, 100, 100);
                        doc.text(`Code: ${elevOpt.opt.code}`, 20, textY + 6);
                    }
                    selectedOptions = []; 
                }
            }

            // SELECTED OPTIONS PAGE
            if (selectedOptions.length > 0) {
                doc.addPage();
                
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(20);
                doc.setTextColor(30, 30, 30);
                doc.text(`${floor.Name} Upgrades`, 20, 25);
                doc.line(20, 30, pageWidth - 20, 30);

                let yPos = 40;

                for (const item of selectedOptions) {
                    if (yPos > pageHeight - 45) {
                        doc.addPage();
                        yPos = 20;
                    }

                    let base64Thumb = null;
                    if (item.opt.Thumbnail && item.opt.Thumbnail !== 'null') {
                        base64Thumb = await getBase64ImageFromUrl(item.opt.Thumbnail);
                    }

                    if (base64Thumb) {
                        const thumbProps = doc.getImageProperties(base64Thumb);
                        const thumbWidth = 40; 
                        const thumbHeight = (thumbProps.height * thumbWidth) / thumbProps.width; 
                        
                        doc.addImage(base64Thumb, 'PNG', 20, yPos, thumbWidth, thumbHeight);
                    } else {
                        doc.setDrawColor(200, 200, 200);
                        doc.rect(20, yPos, 40, 30);
                    }

                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(12);
                    doc.setTextColor(236, 141, 68); 
                    doc.text(item.set.Name.toUpperCase(), 65, yPos + 10);

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(14);
                    doc.setTextColor(30, 30, 30); 
                    doc.text(item.opt.Name, 65, yPos + 20);

                    if (item.opt.code) {
                        doc.setFontSize(10);
                        doc.setTextColor(120, 120, 120);
                        doc.text(`Code: ${item.opt.code}`, 65, yPos + 28);
                    }

                    yPos += 45; 
                }
            }
        }

        const saveName = clientName ? `${clientName.replace(/\s+/g, '_')}_${modelName}_Brochure.pdf` : `${modelName}_Brochure.pdf`;
        doc.save(saveName);

    } catch (err) {
        console.error("PDF generation failed:", err);
        alert("There was an error generating your PDF. Please ensure your images are loading correctly.");
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

// Hook up the button to open the Modal instead of firing the PDF immediately
getEl('exportBrochureBtn').addEventListener('click', openLeadCaptureModal);

// START THE APP
initializeClientApp();