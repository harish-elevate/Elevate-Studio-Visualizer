import { state, db, loadDataFromSupabase } from './state.js';
import { supabase } from './supabaseClient.js';

// --- DOM UTILITIES ---
const getEl = (id) => document.getElementById(id);
const hide = (id) => {
    getEl(id).classList.add('hidden');
    // Reset the modal width back to normal every time it closes!
    if (id === 'modal') getEl('modal').querySelector('.modal-content').style.maxWidth = '';
};
const show = (id) => getEl(id).classList.remove('hidden');

// ==========================================
    // MOBILE LOGIC: STREAMLINED
    // ==========================================
    document.addEventListener('click', function(e) {
        const isFloorPlanMode = document.body.classList.contains('is-floor-plan');
        const overlay = document.getElementById('customizerOptionSets');
        
        // 1. BACKGROUND CLICK CLOSE 
        // Only run this if we are actively looking at a Floor Plan! (Fixes the Elevation bug)
        if (isFloorPlanMode && overlay && e.target === overlay) {
            overlay.classList.add('hidden');
            const msg = document.getElementById('sidebarDefaultMessage');
            if (msg && !msg.classList.contains('hide-permanently')) msg.classList.remove('hidden');
            if (typeof currentActiveSidebarContext !== 'undefined') currentActiveSidebarContext = null;
            return;
        }

        // 2. SMART AUTO-CLOSE (Only on mobile, Floor Plan mode)
        if (window.innerWidth <= 767 && isFloorPlanMode) {
            const btn = e.target.closest('button');
            if (!btn) return;

            if (btn.closest('#customizerOptionSets') || btn.closest('#modal')) {
                const text = btn.textContent.toLowerCase();
                
                if (text.includes('add') || text.includes('select') || text.includes('remove')) {
                    setTimeout(() => {
                        const modal = document.getElementById('modal');
                        const modalTitle = document.getElementById('modalTitle') ? document.getElementById('modalTitle').textContent : '';
                        
                        // CRITICAL FIX: If the Prerequisite or Conflict modal is open, ABORT the auto-close!
                        if (modal && !modal.classList.contains('hidden') && (modalTitle.includes('Unlock') || modalTitle.includes('Conflict'))) {
                            return; 
                        }
                        
                        // Otherwise, close the menus safely
                        if (overlay) overlay.classList.add('hidden');
                        if (modal && !modal.classList.contains('hidden')) modal.classList.add('hidden');
                        if (typeof currentActiveSidebarContext !== 'undefined') currentActiveSidebarContext = null;
                    }, 150);
                }
            }
        }
    }, true);

    // 2. BACKGROUND CLICK CLOSE
    document.addEventListener('click', function(e) {
        const overlay = document.getElementById('customizerOptionSets');
        if (overlay && e.target === overlay) {
            overlay.classList.add('hidden');
            document.getElementById('sidebarDefaultMessage').classList.remove('hidden');
            if (typeof currentActiveSidebarContext !== 'undefined') currentActiveSidebarContext = null;
        }
    });


    // 3. FOOLPROOF ELEVATION TAB CHECKER
    // This runs a safety check every time you click anywhere in the customizer!
    document.addEventListener('click', () => {
        setTimeout(() => {
            if (typeof wizardSteps === 'undefined' || typeof currentStepIndex === 'undefined') return;
            const stepData = wizardSteps[currentStepIndex];
            if (!stepData) return;
            
            const isElevationTab = stepData.Name && (stepData.Name.toLowerCase().includes('elevation') || stepData.Name.toLowerCase().includes('exterior'));
            
            if (isElevationTab || stepData.isReview) {
                document.body.classList.remove('is-floor-plan'); // Force Full Screen OFF
            } else {
                // Only turn full screen ON if the wizard page is actually visible
                const wizardPage = document.getElementById('wizardPage');
                if (wizardPage && !wizardPage.classList.contains('hidden')) {
                    document.body.classList.add('is-floor-plan');
                }
            }
        }, 50); // Small 50ms delay lets the app switch tabs before checking
    });

// --- WIZARD STATE ---
let wizardSteps = []; 
let currentStepIndex = 0;

// --- INITIALIZATION ---
async function initializeClientApp() {
    getEl('globalLoader').classList.remove('hidden');
    await loadDataFromSupabase();
    
    // --- NEW: INJECT DEFAULT OPTIONS INTO MEMORY ---
    db.Option.filter(o => o.is_default).forEach(opt => {
        const setId = opt.BelongsToOptionSet;
        // If the folder for this option set doesn't exist yet, create it and drop the default in!
        if (!state.customizerSelections[setId]) {
            state.customizerSelections[setId] = [opt.id];
        }
    });
    // -----------------------------------------------
    
    renderLandingPage();
    getEl('globalLoader').classList.add('hidden');
}

// --- LANDING PAGE LOGIC ---
// --- LANDING PAGE LOGIC ---
function renderLandingPage() {
    const grid = getEl('modelHomeGrid');
    grid.innerHTML = '';
    
    if (db.ModelHome.length === 0) {
        grid.innerHTML = '<p>No models available currently. Please check back later.</p>';
        return;
    }
    
    db.ModelHome.forEach(model => {
        // 1. Check if the model is active (defaults to true if the column is newly added)
        const isActive = model.is_active !== false; 
        
        // 2. If it is active, make it a clickable link (<a>). If not, just make it a static box (<div>).
        const card = document.createElement(isActive ? 'a' : 'div');
        card.className = 'model-home-card';
        
        if (isActive) {
            card.href = '#';
            card.style.textDecoration = 'none';
            card.addEventListener('click', (e) => {
                e.preventDefault();
                startWizard(model.id);
            });
        } else {
            // Styling to make inactive cards look "disabled"
            card.style.opacity = '0.75';
            card.style.cursor = 'default';
        }
        
        // 3. Inject the HTML (adding the grayscale filter and the "Coming Soon" badge if inactive)
        card.innerHTML = `
            <div style="position: relative;">
                <img src="${model.CoverImage}" alt="${model.Name}" class="model-home-card-image" ${!isActive ? 'style="filter: grayscale(100%);"' : ''}>
                ${!isActive ? `<div style="position: absolute; top: 15px; right: 15px; background: var(--primary-color); color: white; padding: 6px 12px; border-radius: 4px; font-weight: bold; font-size: 0.8rem; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">Coming Soon</div>` : ''}
            </div>
            <div class="model-home-card-name" style="margin-bottom: 5px;">${model.Name}</div>
            ${model.Description ? `<p style="font-size: 0.9rem; color: #666; margin: 0 15px 15px; text-align: center; line-height: 1.4;">${model.Description}</p>` : ''}
        `;
        
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
        
        // Make it look clickable when hovering
        stepEl.style.cursor = 'pointer';
        stepEl.style.transition = 'all 0.2s ease';

        // Add the click logic
        stepEl.addEventListener('click', () => {
            // If they click the step they are already on, do nothing
            if (currentStepIndex === index) return;

            // 1. Save a snapshot of the CURRENT screen before moving away
            const currentStepData = wizardSteps[currentStepIndex];
            if (!currentStepData.isReview) {
                state.floorSnapshots = state.floorSnapshots || {};
                state.floorSnapshots[currentStepData.id] = captureCanvasSnapshot();
            }

            // 2. Update the index and load the newly clicked step
            currentStepIndex = index;

            // --- INSERT THIS BEFORE loadWizardStep() ---
            const clickedStep = wizardSteps[index];
            if (clickedStep && clickedStep.Name) {
                const isElev = clickedStep.Name.toLowerCase().includes('elevation') || clickedStep.Name.toLowerCase().includes('exterior');
                if (isElev || clickedStep.isReview) {
                    document.body.classList.remove('is-floor-plan');
                } else {
                    document.body.classList.add('is-floor-plan');
                }
            }

            loadWizardStep();
        });

        bar.appendChild(stepEl);
    });
}

let clientCanvas = null;
let lastRenderedFloorId = null; 
let currentActiveSidebarContext = null; 

function loadWizardStep() {
    
    const stepData = wizardSteps[currentStepIndex];
    
    // --- THE BULLETPROOF FULL-SCREEN TAG ---
    // If it's the Elevation tab, Exterior tab, or Review page, turn OFF full screen.
    const isElevationTab = stepData && stepData.Name && (stepData.Name.toLowerCase().includes('elevation') || stepData.Name.toLowerCase().includes('exterior'));
    
    if (isElevationTab || stepData.isReview) {
        document.body.classList.remove('is-floor-plan');
    } else {
        document.body.classList.add('is-floor-plan');
    }

    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
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
        const msgBox = getEl('sidebarDefaultMessage');
        if (msgBox) {
            msgBox.classList.add('hide-permanently');
        }

        const floorSets = db.OptionSet.filter(os => os.BelongsToFloor === currentStepData.id);
        const targets = floorSets.map(s => ({ id: s.id, type: 'OptionSet' }));
        openSidebarMenu(targets);
    } else {
        // Only bring the text back if they haven't learned to click the gear yet!
        const msgBox = getEl('sidebarDefaultMessage');
        if (msgBox && !msgBox.classList.contains('user-learned-to-click')) {
            msgBox.classList.remove('hide-permanently');
            show('sidebarDefaultMessage');
        }
        hide('customizerOptionSets');
    }
    
    getEl('wizardBackBtn').classList.toggle('hidden', currentStepIndex === 0);
    getEl('wizardNextBtn').textContent = currentStepIndex === wizardSteps.length - 2 ? 'Review Design →' : 'Next Step →';

    // --- THE RACE CONDITION FIX ---
    // Give the browser 50ms to shrink the flexbox BEFORE the canvas measures its new height!
    setTimeout(() => {
        renderClientCanvas(currentStepData);
    }, 50);
}

function renderClientCanvas(floorData) {
    if (!floorData) return;

    // --- FULLSCREEN TAG CHECK (Runs on every draw!) ---
    const isElevationCheck = floorData.Name && (floorData.Name.toLowerCase().includes('elevation') || floorData.Name.toLowerCase().includes('exterior'));
    if (isElevationCheck) {
        document.body.classList.remove('is-floor-plan');
    } else {
        document.body.classList.add('is-floor-plan');
    }
    const container = getEl('customizerCanvasContainer').parentElement;
    const canvasWidth = container.offsetWidth;
    const canvasHeight = container.offsetHeight;

    if (!clientCanvas) {
        clientCanvas = new fabric.Canvas('markupCanvas', { 
            selection: false, preserveObjectStacking: true, defaultCursor: 'grab'
        });

        // 1. Scroll Wheel Zoom (Desktop)
        clientCanvas.on('mouse:wheel', function(opt) {
            var delta = opt.e.deltaY;
            var zoom = clientCanvas.getZoom();
            zoom *= 0.999 ** delta;
            if (zoom > 5) zoom = 5; 
            if (zoom < 0.2) zoom = 0.2; 
            clientCanvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);

            updateGearScales();
            
            opt.e.preventDefault();
            opt.e.stopPropagation();
        });

        let isDragging = false;
        let hasMoved = false; 
        let lastPosX, lastPosY;

        // 2. Fabric Mouse/Pan Events
        clientCanvas.on('mouse:down', function(opt) {
            if (opt.target && opt.target.data && opt.target.data.isGear) {
                if (window.innerWidth <= 767) {
                    const msgBox = document.getElementById('sidebarDefaultMessage');
                    if (msgBox) msgBox.classList.add('hide-permanently');
                    msgBox.classList.add('user-learned-to-click');
                }
                return;
            }
            const evt = opt.e;
            
            // ABORT PANNING IF 2 FINGERS (Let Native Zoom handle it)
            if (evt.touches && evt.touches.length >= 2) {
                isDragging = false;
                return;
            }

            isDragging = true;
            hasMoved = false; 
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
            const e = opt.e;
            
            // ABORT PANNING IF 2 FINGERS
            if (e.touches && e.touches.length >= 2) {
                isDragging = false;
                return;
            }

            if (isDragging) {
                let currX, currY;
                if(e.touches && e.touches[0]) {
                    currX = e.touches[0].clientX;
                    currY = e.touches[0].clientY;
                } else {
                    currX = e.clientX;
                    currY = e.clientY;
                }
                
                if (Math.abs(currX - lastPosX) > 2 || Math.abs(currY - lastPosY) > 2) {
                    hasMoved = true;
                }

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
                
                if (!hasMoved) {
                    const currentFloor = wizardSteps[currentStepIndex];
                    const isElevationTab = currentFloor && currentFloor.Name && (currentFloor.Name.toLowerCase().includes('elevation') || currentFloor.Name.toLowerCase().includes('exterior'));

                    if (!isElevationTab) {
                        hide('customizerOptionSets');
                        show('sidebarDefaultMessage');
                        currentActiveSidebarContext = null;
                    }
                }
            } 
        });

        // 3. NATIVE VANILLA JS PINCH ZOOM (Bypasses FabricJS entirely)
        const upperCanvas = clientCanvas.upperCanvasEl;
        let initialPinchDist = null;
        let initialPinchZoom = null;

        upperCanvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                initialPinchDist = Math.sqrt(dx * dx + dy * dy);
                initialPinchZoom = clientCanvas.getZoom();
            }
        }, { passive: false });

        upperCanvas.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2 && initialPinchDist) {
                e.preventDefault(); // Stop screen from scrolling
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const distance = Math.sqrt(dx * dx + dy * dy);

                let scale = distance / initialPinchDist;
                let zoom = initialPinchZoom * scale;
                if (zoom > 5) zoom = 5;
                if (zoom < 0.2) zoom = 0.2;

                // Find exact center between two fingers
                const rect = upperCanvas.getBoundingClientRect();
                const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                const point = new fabric.Point(centerX - rect.left, centerY - rect.top);

                clientCanvas.zoomToPoint(point, zoom);

                updateGearScales();
            }
        }, { passive: false });

        upperCanvas.addEventListener('touchend', (e) => {
            if (e.touches.length < 2) {
                initialPinchDist = null;
                initialPinchZoom = null;
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

// --- NEW: THE Z-INDEX ENFORCER ---
function enforceLayerOrder() {
    if (!clientCanvas) return;
    
    const objects = clientCanvas.getObjects();
    
    objects.sort((a, b) => {
        // 1. Gears and Hotspots ALWAYS stay on the absolute top
        if (a.data && a.data.isGear) return 1;
        if (b.data && b.data.isGear) return -1;
        
        // 2. Ignore non-option objects (send them to bottom)
        if (!a.data || !a.data.id) return -1;
        if (!b.data || !b.data.id) return 1;

        // 3. Find the options in the database
        const optA = db.Option.find(o => o.id === a.data.id);
        const optB = db.Option.find(o => o.id === b.data.id);
        
        if (!optA || !optB) return 0;

        // 4. Check the Admin Panel sorting positions!
        const setA = db.OptionSet.find(s => s.id === optA.BelongsToOptionSet);
        const setB = db.OptionSet.find(s => s.id === optB.BelongsToOptionSet);

        const posA = setA ? setA.position : 0;
        const posB = setB ? setB.position : 0;

        // 5. Sort by Set Position first, then individual Option Position
        if (posA === posB) {
            return (optA.position || 0) - (optB.position || 0);
        }
        return posA - posB;
    });

    // Re-stack everything on the canvas in the perfect mathematical order
    objects.forEach(obj => clientCanvas.bringToFront(obj));
    clientCanvas.requestRenderAll();
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
    
    // 3. THE REAL FIX: Safe Z-Index Stacking
    const overlays = clientCanvas.getObjects().filter(o => o.data && o.data.isOverlay);
    
    // Sort so highest numbers (bottom layers) are FIRST in the array
    overlays.sort((a, b) => {
        const valA = Number(a.data.layerOrder) || 0;
        const valB = Number(b.data.layerOrder) || 0;
        return valB - valA; 
    });

    // Instead of absolute moveTo (which breaks the background), we just pull them to the front sequentially.
    // The highest numbers get pulled first. The lowest numbers (Layer 1) get pulled last, leaving them on top!
    overlays.forEach(obj => {
        clientCanvas.bringToFront(obj);
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
        evaluateSystemPatches(); // <-- NEW: Check for patches!
        
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
        // 1. Create the Master Hit-List
        const idsToRemove = collateralItems.map(c => c.id);
        
        // If they clicked "Remove All", add the main target to the hit-list
        if (actionType === 'remove') {
            idsToRemove.push(targetOpt.id);
        }

        // 2. Batch Remove everything simultaneously across all folders
        Object.keys(state.customizerSelections).forEach(setId => {
            if (setId === 'gallery_picks') return;
            
            // Filter out the hit-list
            state.customizerSelections[setId] = state.customizerSelections[setId].filter(
                savedId => !idsToRemove.includes(savedId)
            );
            
            // Clean up gallery picks
            idsToRemove.forEach(id => {
                if (state.customizerSelections['gallery_picks']) {
                    delete state.customizerSelections['gallery_picks'][id];
                }
            });
        });

        // 3. If it's a Swap, add the new target option safely now that memory is clean
        if (actionType === 'swap') {
            if (!state.customizerSelections[set.id]) state.customizerSelections[set.id] = [];
            if (!set.allow_multiple_selections) {
                state.customizerSelections[set.id] = [targetOpt.id];
            } else {
                if (!state.customizerSelections[set.id].includes(targetOpt.id)) {
                    state.customizerSelections[set.id].push(targetOpt.id);
                }
            }
        }

        // 4. WAKE THE GHOST ENGINE
        // Memory is perfectly updated. Let the engine check if patches need to adapt.
        evaluateSystemPatches();

        // 5. Redraw the world
        const floorData = wizardSteps[currentStepIndex];
        renderClientCanvas(floorData);
        openSidebarMenu(currentActiveSidebarContext);
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
    // 1. DEFAULT STATE: White fill, Orange border, Orange plus sign (Visually smaller, large hit-box)
    const defaultIconUrl = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 40 40"><circle cx="20" cy="20" r="11" fill="white" stroke="none" stroke-width="2"/><path d="M20 15v10M15 20h10" stroke="%23ec8d44" stroke-width="2" stroke-linecap="round" fill="none"/></svg>';
    
    // 2. ACTIVE / HOVER STATE: Orange fill, White border, White plus sign (Visually smaller, large hit-box)
    const activeIconUrl = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 40 40"><circle cx="20" cy="20" r="11" fill="%23ec8d44" stroke="none" stroke-width="2"/><path d="M20 15v10M15 20h10" stroke="white" stroke-width="2" stroke-linecap="round" fill="none"/></svg>';

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

    // MAP OPTION-LEVEL HOTSPOTS 
    const floorOptions = db.Option.filter(o => floorSets.map(s => s.id).includes(o.BelongsToOptionSet) && o.Gear_X !== null && !o.is_system_patch && !o.is_default);
    
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
    // RENDER THE ICONS
    gearMap.forEach((data, keyString) => {
        const { x, y, isActive } = data;
        
        // If it's already customized, render it as Active (Orange). Otherwise, Default (Grey).
        const initialIconUrl = isActive ? activeIconUrl : defaultIconUrl;

        fabric.Image.fromURL(initialIconUrl, (img) => {
            // FIX: Removed the minus width/height math. We will let Fabric center it natively!
            const left = bgMetrics.offsetX + (x / 100) * bgMetrics.width;
            const top = bgMetrics.offsetY + (y / 100) * bgMetrics.height;

            const currentZoom = clientCanvas.getZoom(); // Grab the zoom level in case they are already zoomed in

            img.set({
                left: left, top: top,
                originX: 'center', originY: 'center', // Centers perfectly on your coordinate!
                scaleX: 1 / currentZoom,              // Instantly applies inverse scaling
                scaleY: 1 / currentZoom,
                selectable: false, evented: true, hoverCursor: 'pointer',
                shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.15)', blur: 6, offsetX: 0, offsetY: 2 }),
                data: { isGear: true, layerOrder: 9999 },
                baseScale: 1 // Remembers its starting size for the math
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

    // NEW: Permanently hide the instruction text on mobile after first click
    
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
            if (opt.is_system_patch) return; // <-- NEW: Completely hides patches from the sidebar!

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
                    lockBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px; color:#555555; vertical-align:middle; margin-right:6px;">lock</span> Add to Plan`;
                    lockBtn.style.cssText = `flex: 1; padding: 10px; border-radius: 6px; border: none; font-weight: bold; cursor: pointer; background: var(--primary-color); color: white; font-size: 0.8rem; display: flex; align-items: center; justify-content: center;`;
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
                    confBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px; color:#555555; vertical-align:middle; margin-right:6px;">lock</span> Add to Plan`;
                    confBtn.style.cssText = `flex: 1; padding: 10px; border-radius: 6px; border: none; font-weight: bold; cursor: pointer; background: var(--primary-color); color: white; font-size: 0.8rem; display: flex; align-items: center; justify-content: center;`;
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
                    galBtn.innerHTML = '<span style="display: flex; align-items: center; justify-content: center; gap: 6px;"><span class="material-symbols-outlined" style="font-size: 1.1rem;">photo_camera</span> Explore Styles</span>';
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

// --- NEW GHOST RENDERER ENGINE ---
function evaluateSystemPatches() {
    const patches = db.Option.filter(o => o.is_system_patch);

    patches.forEach(patch => {
        let triggers = [];
        let conflicts = [];
        try {
            triggers = (typeof patch.trigger_options === 'string' ? JSON.parse(patch.trigger_options) : (patch.trigger_options || [])).map(Number);
            conflicts = (typeof patch.conflicts === 'string' ? JSON.parse(patch.conflicts) : (patch.conflicts || [])).map(Number);
        } catch (e) {
            console.warn("Parse error for patch:", patch.Name);
        }

        if (triggers.length === 0) return;

        const allSelectedIds = Object.values(state.customizerSelections).flat().map(Number);
        
        // THE FIX: Changed .some() to .every()
        // Now, it requires EVERY trigger in the list to be active before it turns on.
        const isTriggered = triggers.every(triggerId => allSelectedIds.includes(triggerId));
        
        // Conflicts still use .some() because ANY single conflict should kill the patch.
        const hasConflict = conflicts.some(conflictId => allSelectedIds.includes(conflictId));
        
        const shouldBeOn = isTriggered && !hasConflict;
        
        const patchIsCurrentlyOn = allSelectedIds.includes(patch.id);
        const patchSetId = patch.BelongsToOptionSet;

        if (shouldBeOn && !patchIsCurrentlyOn) {
            if (!state.customizerSelections[patchSetId]) state.customizerSelections[patchSetId] = [];
            if (!state.customizerSelections[patchSetId].includes(patch.id)) {
                state.customizerSelections[patchSetId].push(patch.id);
            }
        } else if (!shouldBeOn && patchIsCurrentlyOn) {
            if (state.customizerSelections[patchSetId]) {
                state.customizerSelections[patchSetId] = state.customizerSelections[patchSetId].filter(id => id !== patch.id);
            }
        }
    });
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

    evaluateSystemPatches(); // <-- NEW: Check for patches before rendering!
    
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
        
        // ADDED: && imgUrl !== 'placeholder' to completely ignore empty package markers
        if (imgUrl && imgUrl.trim() !== '' && imgUrl !== 'placeholder') {
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
            html += `<img src="${url}" onclick="openLightbox(${globalIdx})" style="width: 100%; height: 120px; object-fit: contain; background: #fdfdfd; border-radius: 6px; border: 1px solid #eee; cursor: zoom-in;">`;
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
    getEl('modal').querySelector('.modal-content').style.maxWidth = '900px';
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

    // 1. Is this option ALREADY selected in the main plan?
    const isAlreadySelected = (state.customizerSelections[setId] || []).includes(parseInt(optId));

    if (isAlreadySelected) {
        // It's already in the plan! Just update the style and close the gallery.
        if (!state.customizerSelections['gallery_picks']) state.customizerSelections['gallery_picks'] = {};
        state.customizerSelections['gallery_picks'][optId] = groupName;
        
        renderClientCanvas(floorData); 
        hide('modal');
        openSidebarMenu(currentActiveSidebarContext);
        return;
    }

    // 2. If it is NOT selected yet, we must run it through the logic engine!
    // First, quietly save their style pick in the background so it applies if they accept the prompts.
    if (!state.customizerSelections['gallery_picks']) state.customizerSelections['gallery_picks'] = {};
    state.customizerSelections['gallery_picks'][optId] = groupName;

    // Close the gallery modal so the warning modals can pop up cleanly
    hide('modal');

    // Run the exact same gauntlet as the standard sidebar buttons
    const statusObj = getOptionLogicStatus(opt);

    if (statusObj.status === 'locked') {
        triggerLogicModal(opt.id, 'req', statusObj.items.join(','));
    } 
    else if (statusObj.status === 'conflict') {
        triggerLogicModal(opt.id, 'conflict', statusObj.items.join(','));
    } 
    else if (statusObj.status === 'available') {
        // Check for collateral damage (swapping out an existing option that others depend on)
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
            const uniqueCollateral = [...new Map(collateral.map(item => [item.id, item])).values()];
            triggerCollateralModal(opt, uniqueCollateral, 'swap', set);
        } else {
            handleOptionClick(opt, set); 
        }
    }
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
                    if (opt && !opt.hide_in_review) { 
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
        if (!imageUrl || imageUrl === 'null') return resolve(null); 
        
        const img = new Image();
        let isDone = false;
        
        // Failsafe closer: ensures we only resolve once
        const finish = (res) => { 
            if (!isDone) { 
                isDone = true; 
                resolve(res); 
            } 
        };

        // Only apply CORS rules to external internet links, not local data
        if (!imageUrl.startsWith('data:')) {
            img.crossOrigin = 'Anonymous';
        }

        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                
                if (width === 0 || height === 0) return finish(null);

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
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, width, height);
                finish(canvas.toDataURL('image/jpeg', 0.75));
            } catch(e) {
                finish(null);
            }
        };
        img.onerror = () => finish(null);
        img.src = imageUrl;

        // THE STRICT FAILSAFE: If it takes longer than 2 seconds, skip it!
        setTimeout(() => finish(null), 2000); 
    });
}

function openLeadCaptureModal() {
    // 1. Updated Title
    getEl('modalTitle').textContent = 'Where To Send Your Brochure';
    
    getEl('modalForm').innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 15px; margin-top: 15px;">
            <p style="color: #666; font-size: 0.9rem; margin-bottom: 5px;">Please enter your details to receive your custom home brochure via email.</p>
            
            <input type="text" id="pdfClientName" autocomplete="name" placeholder="Full Name (Required)" style="padding: 12px; border: 1px solid #ccc; border-radius: 4px; font-family: var(--font-body);" required>
            <input type="email" id="pdfClientEmail" autocomplete="email" placeholder="Email Address (Required)" style="padding: 12px; border: 1px solid #ccc; border-radius: 4px; font-family: var(--font-body);" required>
            <input type="tel" id="pdfClientPhone" autocomplete="tel" placeholder="Phone Number (Optional)" style="padding: 12px; border: 1px solid #ccc; border-radius: 4px; font-family: var(--font-body);">
            <select id="pdfClientCity" style="padding: 12px; border: 1px solid #ccc; border-radius: 4px; font-family: var(--font-body); background-color: #fff;" required>
                <option value="" disabled selected>Which city are you looking to build in?</option>
                <option value="Did not decide city yet">Did not decide city yet</option>
                <option value="Kansas City MO">Kansas City MO</option>
                <option value="Lee's Summit">Lee's Summit</option>
                <option value="Olathe">Olathe</option>
                <option value="Overland Park">Overland Park</option>
                <option value="Shawnee">Shawnee</option>
                <option value="Blue Springs">Blue Springs</option>
                <option value="Raymore">Raymore</option>
                <option value="Raytown">Raytown</option>
                <option value="Belton">Belton</option>
                <option value="Grandview">Grandview</option>
                <option value="Lenexa">Lenexa</option>
                <option value="City Not Listed">City Not Listed</option>
            </select>
        </div>
    `;
    
    const saveBtn = getEl('modalSave');
    
    // 3. Updated Button Text
    saveBtn.textContent = 'Send My Brochure';
    saveBtn.classList.remove('hidden');
    
    const newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
    
    getEl('modalCancel').onclick = () => hide('modal');

    // ... The rest of your newSaveBtn.addEventListener logic stays EXACTLY the same!
    
    getEl('modalCancel').onclick = () => hide('modal');
    
    newSaveBtn.addEventListener('click', async () => {
        const nameInput = getEl('pdfClientName');
        const emailInput = getEl('pdfClientEmail');
        const phoneInput = getEl('pdfClientPhone');
        const cityInput = getEl('pdfClientCity');

        const name = nameInput.value.trim();
        const email = emailInput.value.trim();
        const phone = phoneInput.value.trim();
        const city = cityInput.value;

        if (!name || !email || !city) {
            alert("Please provide your Name, Email, and City to download your custom brochure.");
            nameInput.style.borderColor = name ? '#ccc' : 'red';
            emailInput.style.borderColor = email ? '#ccc' : 'red';
            cityInput.style.borderColor = city ? '#ccc' : 'red';
            return; 
        }

        nameInput.style.borderColor = '#ccc';
        emailInput.style.borderColor = '#ccc';
        cityInput.style.borderColor = '#ccc';

        const currentModel = db.ModelHome.find(m => m.id === state.currentModelHomeId);
        const modelName = currentModel ? currentModel.Name : 'Custom Home';

        hide('modal');

        // --- THE PREMIUM LOADER ---
        const loaderHtml = `
            <div id="premiumLoaderOverlay" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(255,255,255,0.85); backdrop-filter: blur(8px); z-index: 99999; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 20px;">
                <div style="position: relative; width: 80px; height: 80px; display: flex; align-items: center; justify-content: center; margin-bottom: 30px;">
                    <div style="position: absolute; width: 100%; height: 100%; border: 4px solid #eee; border-top-color: var(--primary-color); border-radius: 50%; animation: pdfSpin 1s linear infinite;"></div>
                    <span style="font-size: 40px; color: var(--primary-color); font-weight: bold; font-family: sans-serif;">+</span>
                </div>
                <h2 style="color: var(--headings-dark); margin-bottom: 15px; font-family: var(--font-heading);">Your custom brochure is being generated.</h2>
                <p style="max-width: 550px; color: #555; line-height: 1.6; font-size: 1.1rem; font-family: var(--font-body);">Thank you for customizing an Elevate Design + Build plan. The <strong>${modelName}</strong> is one of our most popular plans. Our team is generating pricing for your custom house now! Looking forward to connecting with you soon.</p>
                <style>@keyframes pdfSpin { 100% { transform: rotate(360deg); } }</style>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', loaderHtml);

        try {
            // --- BUILD HUMAN-READABLE HTML SELECTIONS ---
            let formattedSelections = '<ul style="margin:0; padding-left:20px; font-family: Arial, sans-serif; font-size: 14px; color: #333;">';
            let hasSelections = false;

            Object.keys(state.customizerSelections).forEach(setId => {
                if (setId === 'gallery_picks') return; 
                const setRef = db.OptionSet.find(s => s.id == setId);
                if (!setRef) return;

                const selectedOptIds = state.customizerSelections[setId] || [];
                const idsArray = Array.isArray(selectedOptIds) ? selectedOptIds : [selectedOptIds];
                
                // --- THE FIX: Filter the visible options BEFORE building the list! ---
                const visibleOptIds = idsArray.filter(id => {
                    const o = db.Option.find(opt => opt.id == id);
                    return o && !o.hide_in_review;
                });
                
                if (visibleOptIds.length > 0) {
                    hasSelections = true;
                    formattedSelections += `<li style="margin-bottom: 10px;"><strong>${setRef.Name}:</strong><ul style="margin-top: 4px;">`;
                    visibleOptIds.forEach(optId => {
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

            if (!hasSelections) formattedSelections = '<p style="color: #666; font-style: italic;">No custom upgrades selected.</p>';

            // 1. Generate the PDF quietly in the background (Hold it in memory)
            const pdfBlob = await generatePDFBrochure(name, email, phone, city, modelName);

            if (!pdfBlob) throw new Error("Failed to generate PDF blob.");

            // 2. Upload it to the Supabase 'brochures' bucket
            const safeName = name.replace(/[^a-zA-Z0-9]/g, '_');
            const fileName = `${Date.now()}_${safeName}_Brochure.pdf`;
            
            const { error: uploadError } = await supabase.storage
                .from('brochures')
                .upload(fileName, pdfBlob, { contentType: 'application/pdf' });

            if (uploadError) throw uploadError;

            // 3. Get the public, shareable link for Make.com
            const { data: urlData } = supabase.storage
                .from('brochures')
                .getPublicUrl(fileName);
            
            const publicPdfUrl = urlData.publicUrl;

            // 4. Save the Lead to the Database (Now including the PDF link!)
            const { error: dbError } = await supabase.from('Leads').insert([{
                client_name: name,
                client_email: email,
                client_phone: phone,
                client_city: city, 
                model_name: modelName,
                selections_json: state.customizerSelections,
                selections_text: formattedSelections,
                brochure_url: publicPdfUrl 
            }]);

            if (dbError) throw dbError;

            try {
                // REPLACE THIS STRING WITH YOUR ACTUAL MAKE.COM WEBHOOK URL!
                await fetch('https://hook.us2.make.com/wuo1b07ufi1z5macvgnzj9bh5r5vk32m', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: name,
                        email: email,
                        phone: phone,
                        city: city,
                        modelName: modelName,
                        brochureUrl: publicPdfUrl
                    })
                });
            } catch (webhookErr) {
                console.error("Warning: Webhook failed to fire, but lead was saved.", webhookErr);
            }

            await new Promise(resolve => setTimeout(resolve, 6000));

            // 5. --- THE NEW EMAIL SUCCESS SCREEN ---
            const loaderOverlay = document.getElementById('premiumLoaderOverlay');
            if (loaderOverlay) {
                loaderOverlay.innerHTML = `
                    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); max-width: 500px;">
                        <span class="material-symbols-outlined" style="font-size: 60px; color: #4caf50; margin-bottom: 20px;">mark_email_read</span>
                        <h2 style="color: var(--headings-dark); margin-bottom: 15px; font-family: var(--font-heading);">It's on the way!</h2>
                        <p style="color: #666; font-size: 1rem; margin-bottom: 30px; line-height: 1.5;">Your custom brochure has been generated and emailed to <strong>${email}</strong>. It should arrive in the next few minutes. <br><br><span style="font-size: 0.85rem; color: #888;">(Don't forget to check your spam folder just in case!)</span></p>
                        
                        <div style="display: flex; gap: 15px; width: 100%;">
                            <button id="btnGoBack" style="flex: 1; padding: 12px; border-radius: 6px; border: 2px solid var(--primary-color); background: white; color: var(--primary-color); font-weight: bold; cursor: pointer; font-size: 0.95rem; transition: all 0.2s;">
                                Back to Customizer
                            </button>
                            <button id="btnStartNew" style="flex: 1; padding: 12px; border-radius: 6px; border: none; background: var(--primary-color); color: white; font-weight: bold; cursor: pointer; font-size: 0.95rem; transition: all 0.2s;">
                                Start New Design
                            </button>
                        </div>
                    </div>
                `;

                document.getElementById('btnGoBack').addEventListener('click', () => loaderOverlay.remove());
                document.getElementById('btnStartNew').addEventListener('click', () => window.location.reload());
            }

        } catch (err) {
            console.error("Error processing brochure:", err);
            alert("There was an issue generating your brochure. Please try again.");
            const loader = document.getElementById('premiumLoaderOverlay');
            if (loader) loader.remove(); 
        }
    });
    
    show('modal');
} // <-- This brace closes openLeadCaptureModal properly!

// --- AND HERE IS THE SECOND FUNCTION ---

async function generatePDFBrochure(clientName, clientEmail, clientPhone, clientCity, modelName) {
    
    const getSafeDimensions = (dataUrl) => new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve({ w: img.width, h: img.height });
        img.onerror = () => resolve(null);
        img.src = dataUrl;
    });

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const dateString = new Date().toLocaleDateString();

        // 1. Fetch and inject the logo for the automated PDF
        const logoUrl = 'https://uaaravrwirbwwthpkvwu.supabase.co/storage/v1/object/public/plans/Untitled%20design%20(77).png'; 
        const logoBase64 = await getBase64ImageFromUrl(logoUrl);
        
        if (logoBase64) {
            // Centers the logo. (X: center minus half width, Y: 30mm, Width: 80mm, Height: 32mm)
            doc.addImage(logoBase64, 'PNG', (pageWidth / 2) - 40, 30, 80, 32); 
        } else {
            // Fallback just in case the image link breaks
            doc.setFont('helvetica', 'bold').setFontSize(28).setTextColor(30, 30, 30);
            doc.text('Elevate Design + Build', pageWidth / 2, 60, { align: 'center' });
        }
        doc.setFont('helvetica', 'normal').setFontSize(18).setTextColor(236, 141, 68); 
        doc.text(`Model: ${modelName}`, pageWidth / 2, 80, { align: 'center' });
        doc.setDrawColor(200, 200, 200).line(40, 90, pageWidth - 40, 90);

        doc.setFontSize(14).setTextColor(100, 100, 100);
        let currentY = 110;
        if (clientName) { doc.text(`Prepared for: ${clientName}`, pageWidth / 2, currentY, { align: 'center' }); currentY += 10; }
        if (clientEmail) { doc.text(clientEmail, pageWidth / 2, currentY, { align: 'center' }); currentY += 10; }
        if (clientPhone) { doc.text(clientPhone, pageWidth / 2, currentY, { align: 'center' }); currentY += 10; }
        if (clientCity) { doc.text(`Build City: ${clientCity}`, pageWidth / 2, currentY, { align: 'center' }); currentY += 10; }
        
        currentY += 5;
        doc.text(`Date: ${dateString}`, pageWidth / 2, currentY, { align: 'center' });

        let copyY = pageHeight - 65;
        doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(236, 141, 68);
        const excitingText = "That was exciting";
        doc.text(excitingText, 25, copyY);
        const textWidth = doc.getTextWidth(excitingText);
        
        doc.setFont('helvetica', 'normal').setTextColor(100, 100, 100);
        doc.text(" — nice work bringing one of our most popular floor plans to life!", 25 + textWidth, copyY);
        
        copyY += 7;
        const paragraph = "You just took the first step toward a home that's designed around the way you live, with modern style, smart functionality, and welcoming spaces made for gathering, celebrating, and making memories.\n\nOur team is already reviewing your selections, and we'll be in touch soon with a detailed estimated investment so you can take the next step toward making your dream home a reality.";
        const splitText = doc.splitTextToSize(paragraph, pageWidth - 50);
        doc.text(splitText, 25, copyY);

        for (const floor of wizardSteps.filter(step => !step.isReview)) {
            const isElevation = floor.Name.toLowerCase().includes('elevation') || floor.Name.toLowerCase().includes('exterior');
            const snapshotUrl = state.floorSnapshots && state.floorSnapshots[floor.id];
            const floorSets = db.OptionSet.filter(os => os.BelongsToFloor === floor.id).sort((a,b) => a.position - b.position);
            
            let selectedOptions = [];
            floorSets.forEach(set => {
                const selectedIds = state.customizerSelections[set.id] || [];
                (Array.isArray(selectedIds) ? selectedIds : [selectedIds]).forEach(optId => {
                    const opt = db.Option.find(o => o.id === optId);
                    if (opt && !opt.hide_in_review) {
                        selectedOptions.push({ set, opt });
                    }
                });
            });

            if (snapshotUrl || selectedOptions.length > 0) {
                doc.addPage();
                doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(236, 141, 68);
                doc.text(floor.Name, 20, 25);
                doc.setDrawColor(200, 200, 200).line(20, 30, pageWidth - 20, 30);

                let pdfImgHeight = 0;
                if (snapshotUrl) {
                    try {
                        const dims = await getSafeDimensions(snapshotUrl);
                        if (dims && dims.w > 0) {
                            const pdfImgWidth = pageWidth - 40; 
                            pdfImgHeight = (dims.h * pdfImgWidth) / dims.w;
                            doc.addImage(snapshotUrl, 'JPEG', 20, 40, pdfImgWidth, pdfImgHeight);
                        }
                    } catch(e) {
                        console.warn("Safely skipped floor plan snapshot", e);
                    }
                }

                if (isElevation && selectedOptions.length > 0) {
                    const elevOpt = selectedOptions[0]; 
                    const textYPos = snapshotUrl ? (40 + pdfImgHeight + 15) : 50; 
                    doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(30, 30, 30);
                    doc.text(`Selected Elevation: ${elevOpt.opt.Name}`, 20, textYPos);
                    
                    if (elevOpt.opt.code) {
                        doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(100, 100, 100);
                        doc.text(`Plan Code: ${elevOpt.opt.code}`, 20, textYPos + 7);
                    }
                    selectedOptions = []; 
                }
            }

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
                        try {
                            const dims = await getSafeDimensions(base64Thumb);
                            if (dims && dims.w > 0) {
                                const thumbWidth = 30; 
                                const thumbHeight = (dims.h * thumbWidth) / dims.w; 
                                doc.addImage(base64Thumb, 'JPEG', 20, yPos, thumbWidth, thumbHeight);
                            }
                        } catch(e) {}
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
                                try {
                                    doc.addImage(b64, 'JPEG', 30, yPos, 80, 50); 
                                    doc.setFont('helvetica', 'italic').setFontSize(10).setTextColor(100,100,100);
                                    doc.text(`Selected Style: ${pkgName}`, 30, yPos + 55);
                                    yPos += 65;
                                } catch(e) {}
                            }
                        }
                    }
                    yPos += 5; 
                }
            }
        }

        const pageCount = doc.internal.getNumberOfPages();
        for(let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(150, 150, 150);
            doc.text('Call us: 816-622-8826   |   Elevate Design + Build', pageWidth / 2, pageHeight - 12, { align: 'center' });
        }

        // Instead of downloading, hand the raw file data back to the app!
        return doc.output('blob');

    } catch (err) {
        console.error("PDF generation failed:", err);
        throw err; 
    }
}

// --- EVENT LISTENERS ---
getEl('logoLink').addEventListener('click', (e) => {
    e.preventDefault();
    hide('wizardPage');
    hide('reviewPage');
    show('landingPage');
});

const headerTextLink = getEl('headerTextLink');
if (headerTextLink) {
    headerTextLink.addEventListener('click', (e) => {
        e.preventDefault();
        hide('wizardPage');
        hide('reviewPage');
        show('landingPage');
    });
}

getEl('wizardNextBtn').addEventListener('click', () => {
    const currentStepData = wizardSteps[currentStepIndex];
    // Add this where your tab/step switching logic happens!
    const currentFloor = wizardSteps[currentStepIndex];
    const isElevationTab = currentFloor && currentFloor.Name && (currentFloor.Name.toLowerCase().includes('elevation') || currentFloor.Name.toLowerCase().includes('exterior'));
    
    if (isElevationTab) {
        document.body.classList.remove('is-floor-plan');
    } else {
        document.body.classList.add('is-floor-plan');
    }
    
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


// --- NEW: INVERSE SCALING FOR PLUS SIGNS ---
function updateGearScales() {
    if (!clientCanvas) return;
    const currentZoom = clientCanvas.getZoom();
    clientCanvas.getObjects().forEach(obj => {
        if (obj.data && obj.data.isGear) {
            // Shrink the icon exactly as much as the canvas zooms in!
            obj.set({
                scaleX: (obj.baseScale || 1) / currentZoom,
                scaleY: (obj.baseScale || 1) / currentZoom
            });
        }
    });
    clientCanvas.requestRenderAll();
}

// --- ZOOM LOGIC ---
function handleClientZoom(factor) {
    if (!clientCanvas) return;
    let zoom = clientCanvas.getZoom() * factor;
    if (zoom > 5) zoom = 5;
    if (zoom < 0.2) zoom = 0.2;
    // Zoom perfectly into the center of the screen
    const center = new fabric.Point(clientCanvas.width / 2, clientCanvas.height / 2);
    clientCanvas.zoomToPoint(center, zoom);
    updateGearScales(); // <--- ADDED THIS
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
    updateGearScales(); // <--- ADDED THIS
});

// ==========================================
// BULLETPROOF MOBILE LAYOUT MONITOR
// ==========================================
// This runs 4 times a second. It completely ignores clicks/tabs and simply 
// forces the screen to match whatever page you are currently viewing!
setInterval(() => {
    if (window.innerWidth > 767) return; // Only run on mobile
    if (typeof wizardSteps === 'undefined' || typeof currentStepIndex === 'undefined') return;
    
    const step = wizardSteps[currentStepIndex];
    if (step && step.Name) {
        const isElev = step.Name.toLowerCase().includes('elevation') || step.Name.toLowerCase().includes('exterior');
        
        // If it's Elevation or Review, force Full-Screen OFF
        if (isElev || step.isReview) {
            document.body.classList.remove('is-floor-plan');
        } 
        // If it's a Floor Plan, force Full-Screen ON
        else {
            const wiz = document.getElementById('wizardPage');
            if (wiz && !wiz.classList.contains('hidden')) {
                document.body.classList.add('is-floor-plan');
            }
        }
    }
}, 250);

initializeClientApp();