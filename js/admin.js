import { state, db, loadDataFromSupabase } from './state.js';
import { getEl, createElement, showView, showCropperModal, showModal, hideModal, showSortableListModal } from './ui.js';
import * as data from './data.js';

// --- GLOBAL VARIABLES ---
let optionSetSortable = null;
let optionSortables = [];
let adminFabricCanvas = null; 
let activeElevationId = null; 

// --- HELPER: GET OPTIONS FOR CHECKLIST ---
// Generates the list for Requirements/Conflicts dropdowns
// Scoped to the current model only
function getAllOptionsForSelect(currentOptionId = null) {
    const list = [];
    // Sort sets by position
    const sortedSets = db.OptionSet.sort((a,b) => a.position - b.position);
    
    sortedSets.forEach(set => {
        const floor = db.Floor.find(f => f.id === set.BelongsToFloor);
        
        // Only show options from floors belonging to the CURRENT model
        if (!floor || floor.BelongsToModel !== state.currentModelHomeId) {
            return;
        }

        const floorName = floor.Name;
        const options = db.Option.filter(o => o.BelongsToOptionSet === set.id).sort((a,b) => a.position - b.position);
        
        options.forEach(opt => {
            // Don't list self as a requirement
            if (currentOptionId && opt.id === currentOptionId) {
                return; 
            }
            
            list.push({
                label: `${floorName} > ${set.Name} > ${opt.Name}`,
                value: opt.id
            });
        });
    });
    return list;
}

// --- CROPPING WORKFLOW ---
async function handleOptionImageCrop(option) {
    // Add timestamp to prevent caching issues
    const originalImageUrl = `${option.OptionImage}?t=${new Date().getTime()}`;

    showCropperModal(originalImageUrl, async (blob) => {
        alert('Uploading cropped image, please wait...');
        
        const newImageUrl = await data.uploadImage(blob);
        
        if (newImageUrl) {
            // Update both main image and thumbnail
            await data.updateOption(option.id, {
                OptionImage: newImageUrl,
                Thumbnail: newImageUrl 
            });
            
            await loadDataFromSupabase();
            
            // Refresh the correct view
            if (activeElevationId === option.id) { 
                renderAdminCanvas(); 
            } else { 
                renderAdminEditor(); 
            }
            
            alert('Image cropped and saved successfully!');
        } else {
            alert('Error: Failed to upload the new image.');
        }
    });
}

// Global click to close and return dropdown to origin
document.addEventListener('click', (e) => {
    const openDD = document.querySelector('.option-dropdown.show');
    if (openDD && !openDD.contains(e.target)) {
        openDD.classList.remove('show');
        const originId = openDD.getAttribute('data-origin');
        const originEl = document.getElementById(originId);
        if (originEl) {
            originEl.appendChild(openDD); // Move it back to the sidebar
        }
    }
});

// --- OPTION MENU CLEANUP LOGIC ---
function closeAllOptionDropdowns() {
    document.querySelectorAll('.option-dropdown.show').forEach(d => {
        d.classList.remove('show');
        // Move it back to its original card
        const originId = d.getAttribute('data-origin');
        if (originId) {
            const originEl = document.getElementById(originId);
            if (originEl) originEl.appendChild(d);
        }
    });
}

// 1. Close on outside click
document.addEventListener('click', (e) => {
    if (!e.target.closest('.option-dropdown') && !e.target.closest('.option-actions-btn')) {
        closeAllOptionDropdowns();
    }
});

// 2. Close if ANY part of the page or sidebar is scrolled (True native UI feel)
document.addEventListener('scroll', (e) => {
    if (!e.target.closest || !e.target.closest('.option-dropdown')) {
        closeAllOptionDropdowns();
    }
}, true); // The "true" makes it capture scroll events from nested sidebars!

// --- NEW THUMBNAIL CROPPER WORKFLOW ---
async function handleThumbnailCrop(option) {
    if (!option.Thumbnail) return alert("No thumbnail image found to crop!");
    
    const originalImageUrl = `${option.Thumbnail}?t=${new Date().getTime()}`;

    // Pass 4/3 at the end to lock it to a perfect thumbnail ratio!
    showCropperModal(originalImageUrl, async (blob) => {
        alert('Uploading cropped thumbnail, please wait...');
        const newImageUrl = await data.uploadImage(blob);
        
        if (newImageUrl) {
            await data.updateOption(option.id, { Thumbnail: newImageUrl });
            await loadDataFromSupabase();
            renderAdminEditor(); 
        } else {
            alert('Error: Failed to upload the new image.');
        }
    }); 
}

// --- ADMIN CANVAS (FABRIC.JS ENGINE) ---
export function renderAdminCanvas() {
    const container = getEl('adminCanvasContainer');
    const floor = db.Floor.find(f => f.id === state.currentFloorId);

    // 1. Initialize Fabric Canvas (One time setup)
    if (!adminFabricCanvas) {
        container.innerHTML = '<canvas id="adminFabricCanvasEl"></canvas>';
        adminFabricCanvas = new fabric.Canvas('adminFabricCanvasEl', {
            selection: false, 
            preserveObjectStacking: true,
            defaultCursor: 'default'
        });
        setupAdminFabricListeners();
    }

    // 2. Handle Empty State
    if (!floor) {
        adminFabricCanvas.clear();
        adminFabricCanvas.setBackgroundColor('#f0f0f0', adminFabricCanvas.renderAll.bind(adminFabricCanvas));
        return;
    }

    // 3. Determine Image Source (Blueprint vs Elevation)
    const wrapper = container.parentElement; 
    const canvasWidth = wrapper.offsetWidth;
    const canvasHeight = wrapper.offsetHeight;
    
    adminFabricCanvas.setDimensions({ 
        width: canvasWidth, 
        height: canvasHeight 
    });
    adminFabricCanvas.clear(); 

    let imageUrl = floor.BasePlanImage;
    const isElevationTab = floor.Name.toLowerCase().includes('elevation') || floor.Name.toLowerCase().includes('exterior');

    // Elevation Logic
    if (isElevationTab) {
        imageUrl = null; 
        const optionSetsForFloor = db.OptionSet.filter(os => os.BelongsToFloor === state.currentFloorId).map(os => os.id);
        const optionsToRender = db.Option.filter(opt => optionSetsForFloor.includes(opt.BelongsToOptionSet));
        
        // If specific thumbnail clicked, use it
        if (activeElevationId) {
            const selectedOpt = optionsToRender.find(o => o.id === activeElevationId);
            if (selectedOpt && selectedOpt.OptionImage) {
                imageUrl = selectedOpt.OptionImage;
            }
        }
        // Fallback to first available
        if (!imageUrl && optionsToRender.length > 0 && optionsToRender[0].OptionImage) {
            imageUrl = optionsToRender[0].OptionImage;
            activeElevationId = optionsToRender[0].id;
        }
    }

    // Placeholder if no image
    if (!imageUrl || imageUrl === 'null' || imageUrl === '') {
        adminFabricCanvas.bgMetrics = { 
            scale: 1, 
            offsetX: 0, 
            offsetY: 0, 
            width: canvasWidth, 
            height: canvasHeight 
        };
        
        adminFabricCanvas.setBackgroundColor('#ffffff', adminFabricCanvas.renderAll.bind(adminFabricCanvas));
        
        const message = isElevationTab 
            ? 'Elevation View\n\nSelect an option from the sidebar to preview.' 
            : 'No Base Plan Image Uploaded';
            
        const text = new fabric.Text(message, {
            fontSize: 16, 
            fill: '#999', 
            originX: 'center', 
            originY: 'center',
            left: canvasWidth / 2, 
            top: canvasHeight / 2, 
            selectable: false
        });
        adminFabricCanvas.add(text);
        return; 
    }

    // Load Image
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
        const scale = Math.min(canvasWidth / image.width, canvasHeight / image.height);
        const bgImgOffsetX = (canvasWidth - image.width * scale) / 2;
        const bgImgOffsetY = (canvasHeight - image.height * scale) / 2;
        
        adminFabricCanvas.bgMetrics = { 
            scale: scale, 
            offsetX: bgImgOffsetX, 
            offsetY: bgImgOffsetY, 
            width: image.width * scale, 
            height: image.height * scale 
        };
        
        adminFabricCanvas.setBackgroundImage(imageUrl, adminFabricCanvas.renderAll.bind(adminFabricCanvas), { 
            originX: 'left', 
            originY: 'top', 
            crossOrigin: 'anonymous', 
            scaleX: scale, 
            scaleY: scale, 
            left: bgImgOffsetX, 
            top: bgImgOffsetY 
        });

        if (!isElevationTab) {
            const optionSetsForFloor = db.OptionSet.filter(os => os.BelongsToFloor === state.currentFloorId).map(os => os.id);
            const optionsToRender = db.Option.filter(opt => optionSetsForFloor.includes(opt.BelongsToOptionSet));
            
            optionsToRender.forEach(option => {
                if (!option.OptionImage) return;
                
                fabric.Image.fromURL(option.OptionImage, (img) => {
                    const left = bgImgOffsetX + (option.X_Position / 100) * adminFabricCanvas.bgMetrics.width;
                    const top = bgImgOffsetY + (option.Y_Position / 100) * adminFabricCanvas.bgMetrics.height;
                    const width = (option.Width / 100) * adminFabricCanvas.bgMetrics.width;
                    const height = (option.Height / 100) * adminFabricCanvas.bgMetrics.height;
                    
                    img.set({ 
                        left: left, 
                        top: top, 
                        scaleX: width / (img.width || 1), 
                        scaleY: height / (img.height || 1), 
                        selectable: false, 
                        evented: false, 
                        lockRotation: true, 
                        hasControls: true, 
                        hasBorders: true, 
                        data: { id: option.id, name: option.Name } 
                    });
                    
                    img.setControlsVisibility({ mtr: false });
                    adminFabricCanvas.add(img);
                    
                    if(state.editingOptionPositionId === option.id) { 
                        enterPositionEditMode(option.id, false); 
                    }
                }, { crossOrigin: 'anonymous' });
            });
        }
    };
    image.onerror = () => { 
        adminFabricCanvas.setBackgroundColor('#f0f0f0', adminFabricCanvas.renderAll.bind(adminFabricCanvas)); 
    };
    image.src = imageUrl;
}

function setupAdminFabricListeners() {
    let isDragging = false;
    let lastPosX;
    let lastPosY;
    let lastClickTime = 0;

    adminFabricCanvas.on('mouse:down', (opt) => {
        const evt = opt.e;
        const currentTime = new Date().getTime();
        
        // Triple Click Logic for Crop
        if (currentTime - lastClickTime < 400) {
            const pointer = adminFabricCanvas.getPointer(evt);
            const targets = adminFabricCanvas.getObjects().filter(o => o.containsPoint(pointer));
            if (targets.length > 0) {
                 const target = targets[targets.length - 1]; 
                 if (target.data && target.data.id && state.editingOptionPositionId === target.data.id) {
                     const option = db.Option.find(o => o.id === target.data.id);
                     if(option) handleOptionImageCrop(option);
                     return;
                 }
            }
        }
        lastClickTime = currentTime;
        
        // Panning Logic
        if (!opt.target || !opt.target.selectable) { 
            isDragging = true; 
            adminFabricCanvas.selection = false; 
            lastPosX = evt.clientX; 
            lastPosY = evt.clientY; 
            adminFabricCanvas.defaultCursor = 'grabbing'; 
            adminFabricCanvas.setCursor('grabbing'); 
        }
    });

    adminFabricCanvas.on('mouse:move', (opt) => {
        if (isDragging) {
            const e = opt.e;
            const vpt = adminFabricCanvas.viewportTransform;
            vpt[4] += e.clientX - lastPosX;
            vpt[5] += e.clientY - lastPosY;
            adminFabricCanvas.requestRenderAll();
            lastPosX = e.clientX;
            lastPosY = e.clientY;
        }
    });

    adminFabricCanvas.on('mouse:up', () => { 
        if (isDragging) { 
            isDragging = false; 
            adminFabricCanvas.defaultCursor = 'default'; 
            adminFabricCanvas.setCursor('default'); 
        } 
    });
    
    // Pinch Zoom (iPad)
    adminFabricCanvas.on('touch:gesture', function(e) {
        if (e.e.touches && e.e.touches.length == 2) {
            e.e.preventDefault(); 
            if (e.self.state == "start") {
                adminFabricCanvas.startZoom = adminFabricCanvas.getZoom();
            }
            var zoom = adminFabricCanvas.startZoom * e.self.scale;
            if (zoom > 5) zoom = 5;
            if (zoom < 0.2) zoom = 0.2;
            var point = new fabric.Point(e.self.x, e.self.y);
            adminFabricCanvas.zoomToPoint(point, zoom);
        }
    });
    
    // Prevent Scroll Events
    adminFabricCanvas.upperCanvasEl.addEventListener('touchstart', function(e) {
        e.preventDefault(); 
    }, { passive: false });
    
    adminFabricCanvas.upperCanvasEl.addEventListener('touchmove', function(e) {
        e.preventDefault(); 
    }, { passive: false });

    // Mouse Wheel Zoom
    adminFabricCanvas.on('mouse:wheel', function(opt) {
        var delta = opt.e.deltaY;
        var zoom = adminFabricCanvas.getZoom();
        zoom *= 0.999 ** delta;
        if (zoom > 5) zoom = 5; 
        if (zoom < 0.2) zoom = 0.2;
        adminFabricCanvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
        opt.e.preventDefault(); 
        opt.e.stopPropagation();
    });

    // --- NEW: BULLETPROOF DYNAMIC CROP BUTTON ---
    // 1. Create the button dynamically if it doesn't exist
    let cropBtn = document.getElementById('dynamicCropBtn');
    if (!cropBtn) {
        cropBtn = document.createElement('button');
        cropBtn.id = 'dynamicCropBtn';
        cropBtn.className = 'btn-primary';
        cropBtn.innerHTML = '<span class="material-symbols-outlined" style="vertical-align: middle; margin-right: 5px;">crop</span> Crop Selected Image';
        
        // Aggressive CSS to guarantee it floats over EVERYTHING
        cropBtn.style.cssText = 'position: fixed; bottom: 40px; left: 50%; transform: translateX(-50%); z-index: 2147483647; display: none; padding: 12px 24px; font-size: 16px; font-weight: bold; box-shadow: 0 4px 15px rgba(0,0,0,0.5); border-radius: 8px; cursor: pointer;';
        
        document.body.appendChild(cropBtn);
    }

    // 2. Wire up the Canvas Listeners
    adminFabricCanvas.on('selection:created', function(e) {
        if (e.selected && e.selected.length === 1 && e.selected[0].type === 'image') {
            cropBtn.style.display = 'block'; // Show button
        }
    });

    adminFabricCanvas.on('selection:cleared', function() {
        cropBtn.style.display = 'none'; // Hide button
    });

    adminFabricCanvas.on('selection:updated', function(e) {
        if (e.selected && e.selected.length === 1 && e.selected[0].type === 'image') {
            cropBtn.style.display = 'block';
        } else {
            cropBtn.style.display = 'none';
        }
    });

    // 3. The Crop Action
    // Clone the button to wipe out any old event listeners so it doesn't double-fire
    const newCropBtn = cropBtn.cloneNode(true);
    cropBtn.parentNode.replaceChild(newCropBtn, cropBtn);
    
    newCropBtn.addEventListener('click', () => {
        const activeObj = adminFabricCanvas.getActiveObject();
        if (activeObj && activeObj.type === 'image' && activeObj.data && activeObj.data.id) {
            const option = db.Option.find(o => o.id === activeObj.data.id);
            if (option) {
                handleOptionImageCrop(option); // Launches the cropper!
            }
        }
    });
}

function handleAdminZoom(factor) {
    if (!adminFabricCanvas) return;
    const newZoom = adminFabricCanvas.getZoom() * factor;
    const center = new fabric.Point(adminFabricCanvas.width / 2, adminFabricCanvas.height / 2);
    adminFabricCanvas.zoomToPoint(center, Math.max(0.2, Math.min(5, newZoom)));
}

function resetAdminZoom() {
    if (!adminFabricCanvas) return;
    adminFabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
}

export function setupAdminControls() {
    getEl('adminZoomInBtn').addEventListener('click', () => handleAdminZoom(1.2));
    getEl('adminZoomOutBtn').addEventListener('click', () => handleAdminZoom(0.8));
    getEl('adminZoomResetBtn').addEventListener('click', resetAdminZoom);
}

// --- EDIT MODE LOGIC ---
export function enterPositionEditMode(optionId, renderControls = true) {
    state.editingOptionPositionId = optionId;
    const option = db.Option.find(o => o.id === optionId);
    
    if (renderControls) {
        const controls = getEl('position-editor-controls');
        controls.innerHTML = '';
        const opacityContainer = createElement('div', { style: 'margin-bottom: 15px;' }, [
            createElement('label', { for: 'opacitySlider', textContent: 'Overlay Opacity: ', style: 'display:block; margin-bottom:5px; font-weight:bold;' }),
            createElement('input', { type: 'range', id: 'opacitySlider', min: '0.1', max: '1', step: '0.1', value: '1', style: 'width:100%;' })
        ]);
        opacityContainer.querySelector('input').addEventListener('input', (e) => {
            if(adminFabricCanvas) {
                const activeObj = adminFabricCanvas.getActiveObject();
                if (activeObj) { 
                    activeObj.set('opacity', parseFloat(e.target.value)); 
                    adminFabricCanvas.renderAll(); 
                }
            }
        });

        // --- THE 3 CONTROL BUTTONS ---
        const saveBtn = createElement('button', { 
            type: 'button', 
            id: 'savePosBtn', 
            textContent: 'Save Position', 
            style: 'flex:1;' 
        });
        
        // NEW: The Native Crop Button!
        const cropBtn = createElement('button', { 
            type: 'button', 
            id: 'cropPosBtn', 
            textContent: 'Crop', 
            style: 'flex:1; background-color: #17a2b8; color: white;' // A nice teal to distinguish it from save/cancel
        });

        const cancelBtn = createElement('button', { 
            type: 'button', 
            id: 'cancelPosBtn', 
            className: 'btn-secondary', 
            textContent: 'Cancel', 
            style: 'flex:1;' 
        });

        // --- BUTTON LISTENERS ---
        saveBtn.addEventListener('click', async () => {
            if (!adminFabricCanvas || !adminFabricCanvas.bgMetrics) return;
            
            const objects = adminFabricCanvas.getObjects();
            const target = objects.find(o => o.data && o.data.id === optionId);
            
            if (!target) {
                alert("Error: Could not find object to save.");
                return;
            }

            const bg = adminFabricCanvas.bgMetrics;
            const relativeLeft = target.left - bg.offsetX;
            const relativeTop = target.top - bg.offsetY;
            const objectWidth = target.width * target.scaleX;
            const objectHeight = target.height * target.scaleY;

            const xPct = (relativeLeft / bg.width) * 100;
            const yPct = (relativeTop / bg.height) * 100;
            const wPct = (objectWidth / bg.width) * 100;
            const hPct = (objectHeight / bg.height) * 100;

            saveBtn.textContent = 'Saving...';
            
            try {
                await data.updateOption(optionId, { 
                    X_Position: xPct, 
                    Y_Position: yPct, 
                    Width: wPct, 
                    Height: hPct 
                });
                
                const localOption = db.Option.find(o => o.id === optionId);
                if(localOption) { 
                    localOption.X_Position = xPct; 
                    localOption.Y_Position = yPct; 
                    localOption.Width = wPct; 
                    localOption.Height = hPct; 
                }
                
                exitPositionEditMode();
            } catch(err) {
                console.error("Save failed", err);
                alert("Failed to save. Check console.");
                saveBtn.textContent = 'Save Position';
            }
        });

        // NEW: Wire the crop button directly to your cropper function
        cropBtn.addEventListener('click', () => {
            // Check if your crop function exists, and trigger it
            if (typeof handleOptionImageCrop === 'function') {
                handleOptionImageCrop(option);
            } else {
                console.log("Preparing to crop:", option.Name);
                alert("Crop function triggered. If the cropper doesn't open, verify your crop function name!");
            }
        });

        cancelBtn.addEventListener('click', () => {
            exitPositionEditMode();
        });

        controls.append(
            createElement('h4', { textContent: `Editing: ${option.Name}`, style: 'margin-bottom:10px; color: var(--primary-color);' }),
            createElement('p', { textContent: 'Drag to move. Drag corners to resize.', style: 'font-size:0.9rem; color:#666; margin-bottom:15px;' }),
            opacityContainer,
            createElement('div', { style: 'display:flex; gap:5px;' }, [ saveBtn, cropBtn, cancelBtn ]) // Placed cleanly in a row
        );
        controls.classList.remove('hidden');
        
        getEl('adminEditor').querySelector('.controls-column').querySelectorAll('button:not(#savePosBtn):not(#cropPosBtn):not(#cancelPosBtn), a').forEach(el => { 
            el.disabled = true; 
            el.style.opacity = '0.5'; 
        });
    }

    if(adminFabricCanvas) {
        const objects = adminFabricCanvas.getObjects();
        objects.forEach(obj => { 
            obj.set({ selectable: false, evented: false, opacity: 0.5 }); 
        });
        
        const target = objects.find(o => o.data && o.data.id === optionId);
        if(target) {
            target.set({ 
                selectable: true, 
                evented: true, 
                opacity: 1, 
                borderColor: '#ec8d44', 
                cornerColor: '#ec8d44', 
                cornerSize: 10, 
                transparentCorners: false 
            });
            adminFabricCanvas.setActiveObject(target);
            adminFabricCanvas.bringToFront(target); // NEW: Forces it perfectly to the top
            adminFabricCanvas.renderAll();
        }
    }
}

export function exitPositionEditMode() {
    state.editingOptionPositionId = null;
    getEl('position-editor-controls').classList.add('hidden');
    getEl('adminEditor').querySelector('.controls-column').querySelectorAll('button, a').forEach(el => { 
        el.disabled = false; 
        el.style.opacity = '1'; 
    });
    renderAdminCanvas();
}

export function enterGearEditMode(id, targetType) {
    state.editingOptionPositionId = `gear_${targetType}_${id}`;
    
    const item = targetType === 'OptionSet' ? db.OptionSet.find(o => o.id === id) : db.Option.find(o => o.id === id);
    const itemName = item.Name;
    
    const gearIconUrl = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="%23ec8d44" stroke="white" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';

    const controls = getEl('position-editor-controls');
    controls.innerHTML = '';
    
    // UI Buttons
    const saveBtn = createElement('button', { id: 'savePosBtn', type: 'button', textContent: 'Save Gear Position', style: 'width:100%; margin-bottom: 10px;' });
    const assignBtn = createElement('button', { id: 'assignGearBtn', type: 'button', textContent: 'Assign to Existing Gear', style: 'width:100%; margin-bottom: 15px; background-color: var(--secondary-color);' });
    const removeBtn = createElement('button', { id: 'removePosBtn', type: 'button', className: 'btn-danger', textContent: 'Remove Gear', style: 'flex:1;' });
    const cancelBtn = createElement('button', { id: 'cancelPosBtn', type: 'button', className: 'btn-secondary', textContent: 'Cancel', style: 'flex:1;' });

    const btnRow = createElement('div', { style: 'display:flex; gap:10px;' }, [removeBtn, cancelBtn]);

    const instructionText = createElement('p', { textContent: 'Drag the solid orange gear to place it.', style: 'font-size:0.9rem; color:#666; margin-bottom:15px; line-height: 1.4;' });

    // 1. Assign Logic (Show ghost gears on demand)
    assignBtn.addEventListener('click', () => {
        assignBtn.disabled = true;
        assignBtn.textContent = 'Select a faded gear on the canvas...';
        instructionText.textContent = 'Click any faded gear to instantly snap to its location.';

        const floorSets = db.OptionSet.filter(os => os.BelongsToFloor === state.currentFloorId && os.Gear_X !== null);
        const floorOptions = db.Option.filter(o => floorSets.map(s => s.id).includes(o.BelongsToOptionSet) && o.Gear_X !== null);
        
        const uniqueCoords = new Map();
        floorSets.forEach(s => {
            if (targetType === 'OptionSet' && s.id === id) return;
            uniqueCoords.set(`${s.Gear_X},${s.Gear_Y}`, { x: s.Gear_X, y: s.Gear_Y });
        });
        floorOptions.forEach(o => {
            if (targetType === 'Option' && o.id === id) return;
            uniqueCoords.set(`${o.Gear_X},${o.Gear_Y}`, { x: o.Gear_X, y: o.Gear_Y });
        });

        const bg = adminFabricCanvas.bgMetrics;

        // Render Ghost Gears
        uniqueCoords.forEach(coords => {
            fabric.Image.fromURL(gearIconUrl, (img) => {
                const left = bg.offsetX + (coords.x / 100) * bg.width - (img.width/2);
                const top = bg.offsetY + (coords.y / 100) * bg.height - (img.height/2);

                img.set({
                    left: left, top: top,
                    selectable: false, evented: true, opacity: 0.35, hoverCursor: 'pointer',
                    data: { isGhost: true }
                });
                
                // Snap active gear to this position on click
                img.on('mousedown', () => {
                    const activeGear = adminFabricCanvas.getObjects().find(o => o.data && o.data.isGear);
                    if(activeGear) {
                        activeGear.set({ left: img.left, top: img.top });
                        adminFabricCanvas.renderAll();
                    }
                });
                adminFabricCanvas.add(img);
                
                // Ensure active gear stays on top of newly rendered ghosts
                const activeGear = adminFabricCanvas.getObjects().find(o => o.data && o.data.isGear);
                if(activeGear) activeGear.bringToFront();
                
                adminFabricCanvas.renderAll();
            });
        });
    });

    // 2. Save Logic
    saveBtn.addEventListener('click', async () => {
        if (!adminFabricCanvas || !adminFabricCanvas.bgMetrics) return;
        
        const objects = adminFabricCanvas.getObjects();
        const target = objects.find(o => o.data && o.data.isGear);
        if (!target) return;

        const bg = adminFabricCanvas.bgMetrics;
        const centerLeft = target.left + (target.width * target.scaleX) / 2;
        const centerTop = target.top + (target.height * target.scaleY) / 2;
        const relativeLeft = centerLeft - bg.offsetX;
        const relativeTop = centerTop - bg.offsetY;

        const gearXPct = (relativeLeft / bg.width) * 100;
        const gearYPct = (relativeTop / bg.height) * 100;

        saveBtn.textContent = 'Saving...';
        
        try {
            if (targetType === 'OptionSet') {
                await data.updateOptionSet(id, { Gear_X: gearXPct, Gear_Y: gearYPct });
                const localSet = db.OptionSet.find(o => o.id === id);
                if(localSet) { localSet.Gear_X = gearXPct; localSet.Gear_Y = gearYPct; }
            } else {
                await data.updateOption(id, { Gear_X: gearXPct, Gear_Y: gearYPct });
                const localOpt = db.Option.find(o => o.id === id);
                if(localOpt) { localOpt.Gear_X = gearXPct; localOpt.Gear_Y = gearYPct; }
            }
            exitPositionEditMode();
        } catch(err) {
            console.error("Save failed", err);
            alert("Failed to save gear position.");
            saveBtn.textContent = 'Save Gear Position';
        }
    });

    // 3. Remove Logic
    removeBtn.addEventListener('click', async () => {
        if (!confirm("Are you sure you want to remove this gear icon? It will be hidden from the client visualizer until you place it again.")) return;
        
        removeBtn.textContent = 'Removing...';
        try {
            if (targetType === 'OptionSet') {
                await data.updateOptionSet(id, { Gear_X: null, Gear_Y: null });
                const localSet = db.OptionSet.find(o => o.id === id);
                if(localSet) { localSet.Gear_X = null; localSet.Gear_Y = null; }
            } else {
                await data.updateOption(id, { Gear_X: null, Gear_Y: null });
                const localOpt = db.Option.find(o => o.id === id);
                if(localOpt) { localOpt.Gear_X = null; localOpt.Gear_Y = null; }
            }
            exitPositionEditMode();
        } catch(err) {
            console.error("Remove failed", err);
            alert("Failed to remove gear position.");
            removeBtn.textContent = 'Remove Gear';
        }
    });

    cancelBtn.addEventListener('click', exitPositionEditMode);

    controls.append(
        createElement('h4', { textContent: `Gear Settings: ${itemName}`, style: 'margin-bottom:10px; color: var(--primary-color);' }),
        instructionText,
        saveBtn,
        assignBtn,
        btnRow
    );
    controls.classList.remove('hidden');
    
    // Disable all other sidebar buttons (excluding our 4 new IDs)
    const activeIds = ['savePosBtn', 'cancelPosBtn', 'removePosBtn', 'assignGearBtn'];
    getEl('adminEditor').querySelector('.controls-column').querySelectorAll('button, a').forEach(el => { 
        if(!activeIds.includes(el.id)) { 
            el.disabled = true; el.style.opacity = '0.5'; 
        }
    });

    // Render Initial Canvas (Background dimming + Active Gear only)
    if(adminFabricCanvas) {
        const objects = adminFabricCanvas.getObjects();
        objects.forEach(obj => { obj.set({ selectable: false, evented: false, opacity: 0.2 }); });
        
        const bg = adminFabricCanvas.bgMetrics;

        fabric.Image.fromURL(gearIconUrl, (img) => {
            const existingX = item.Gear_X !== null ? item.Gear_X : 50; 
            const existingY = item.Gear_Y !== null ? item.Gear_Y : 50;

            const left = bg.offsetX + (existingX / 100) * bg.width - (img.width/2);
            const top = bg.offsetY + (existingY / 100) * bg.height - (img.height/2);

            img.set({
                left: left, top: top,
                selectable: true, evented: true, opacity: 1,
                hasControls: false, hasBorders: true, borderColor: '#ec8d44',
                data: { isGear: true }
            });
            
            adminFabricCanvas.add(img);
            adminFabricCanvas.setActiveObject(img);
            img.bringToFront();
            adminFabricCanvas.renderAll();
        });
    }
}

// --- ADMIN RENDER ---
export function initAdminDashboard() { 
    renderAdminDashboard(); 
    showView('adminDashboard'); 
}

export function renderAdminDashboard() {
    const grid = getEl('adminModelHomeGrid');
    grid.innerHTML = '';
    
    if (db.ModelHome.length === 0) { 
        grid.innerHTML = '<p>No models created yet.</p>'; 
        return; 
    }
    
    // 1. Sort the models by their database position
    const sortedModels = db.ModelHome.sort((a, b) => (a.position || 0) - (b.position || 0));
    
    // 2. Build the cards
    sortedModels.map(model => {
        const card = createElement('a', { 
            className: 'model-home-card', 
            'data-model-id': model.id, 
            'data-id': model.id, // <-- Critical for SortableJS to track the ID!
            href: '#' 
        }, [
            createElement('img', { src: model.CoverImage, alt: model.Name, className: 'model-home-card-image' }),
            createElement('div', { className: 'model-home-card-name', textContent: model.Name })
        ]);
        
        card.addEventListener('click', e => { 
            e.preventDefault(); 
            initAdminModelManagement(model.id); 
        });
        
        return card;
    }).forEach(card => grid.append(card));

    // 3. Make the grid Drag-and-Drop Sortable!
    new Sortable(grid, {
        animation: 150,
        onEnd: async (evt) => {
            // Give the user visual feedback that it's saving
            grid.style.opacity = '0.5';
            
            // Map the new visual order into an array of database updates
            const items = Array.from(evt.to.children).map(el => el.dataset.id);
            const updates = items.map((id, index) => ({ id: parseInt(id), position: index }));
            
            // Save to Supabase and reload
            await data.updatePositions('ModelHome', updates);
            await loadDataFromSupabase();
            
            grid.style.opacity = '1';
            renderAdminDashboard();
        }
    });
}

export function initAdminModelManagement(modelId) {
    state.currentModelHomeId = modelId;
    const model = db.ModelHome.find(m => m.id === modelId);
    getEl('manageModelHeader').innerHTML = `Manage Model: <span class="model-name">${model.Name}</span>`;
    getEl('manageModelImage').src = model.CoverImage;
    showView('adminModelManagementPage');
}

export function initAdminEditor(modelId) {
    state.currentModelHomeId = modelId;
    const model = db.ModelHome.find(m => m.id === modelId);
    getEl('editorHeader').querySelector('.model-name').textContent = model.Name;
    const floors = db.Floor.filter(f => f.BelongsToModel === modelId).sort((a, b) => {
        const aIsElev = a.Name.toLowerCase().includes('elevation') || a.Name.toLowerCase().includes('exterior');
        const bIsElev = b.Name.toLowerCase().includes('elevation') || b.Name.toLowerCase().includes('exterior');
        if (aIsElev && !bIsElev) return -1;
        if (!aIsElev && bIsElev) return 1;
        return a.id - b.id;
    });
    state.currentFloorId = floors.length > 0 ? floors[0].id : null;
    state.editingOptionPositionId = null;
    activeElevationId = null; 
    adminFabricCanvas = null; 
    renderAdminEditor();
    showView('adminEditor');
}

export function renderAdminEditor() {
    renderAdminEditorControls(); 
    renderAdminFloorManagement();
    renderAdminCanvas();
    initSortables();
}

export function renderAdminFloorManagement() {
    const container = getEl('adminFloorManagement');
    container.innerHTML = '';
    if (!state.currentFloorId) {
        container.innerHTML = `<h4>No floor selected.</h4><p>Select a floor tab above or create a new one.</p>`;
        getEl('createOptionSetBtn').classList.add('hidden');
        return;
    }
    getEl('createOptionSetBtn').classList.remove('hidden');
    const floor = db.Floor.find(f => f.id === state.currentFloorId);
    container.append(
        createElement('h4', { textContent: `Managing: ${floor.Name}` }),
        createElement('div', { className: 'admin-item-actions' }, [
            createElement('button', { type: 'button', className: 'btn-secondary', id: 'updateFloorBtn', textContent: 'Update Details' }),
            createElement('button', { type: 'button', className: 'btn-danger', id: 'removeFloorBtn', textContent: 'Remove Floor' })
        ])
    );
    
    // Wire up Update Floor Button
    getEl('updateFloorBtn').addEventListener('click', () => {
        const f = db.Floor.find(f => f.id === state.currentFloorId);
        showModal('Update Floor Details', [
            { label: 'Floor Name', id: 'Name', value: f.Name },
            { label: 'New Base Plan Image (Optional)', id: 'BasePlanImage', type: 'file', existingValue: f.BasePlanImage }
        ]);
        state.modalSaveCallback = async (formData) => {
            await data.updateFloor(state.currentFloorId, formData);
            await loadDataFromSupabase();
            renderAdminEditor();
            hideModal();
        };
    });
    
    // Wire up Remove Floor Button
    getEl('removeFloorBtn').addEventListener('click', () => {
        const f = db.Floor.find(f => f.id === state.currentFloorId);
        if (confirm(`Are you sure you want to delete floor "${f.Name}" and all its option sets?`)) {
            data.deleteFloor(state.currentFloorId).then(async () => {
                await loadDataFromSupabase();
                const remaining = db.Floor.filter(x => x.BelongsToModel === state.currentModelHomeId);
                state.currentFloorId = remaining.length > 0 ? remaining[0].id : null;
                renderAdminEditor();
            });
        }
    });
}

// --- RENDER CONTROLS (FULL EXPLODED LOGIC) ---
export function renderAdminEditorControls() {
    const floorTabsContainer = getEl('adminFloorTabs');
    const optionSetsContainer = getEl('adminOptionSetsContainer');
    floorTabsContainer.innerHTML = ''; 
    optionSetsContainer.innerHTML = '';

    const floors = db.Floor.filter(f => f.BelongsToModel === state.currentModelHomeId).sort((a, b) => {
        const aIsElev = a.Name.toLowerCase().includes('elevation') || a.Name.toLowerCase().includes('exterior');
        const bIsElev = b.Name.toLowerCase().includes('elevation') || b.Name.toLowerCase().includes('exterior');
        if (aIsElev && !bIsElev) return -1;
        if (!aIsElev && bIsElev) return 1;
        return a.id - b.id;
    });

    if (floors.length === 0) state.currentFloorId = null;

    floors.forEach(floor => {
        const tab = createElement('button', { 
            type: 'button', 
            className: `floor-tab ${floor.id === state.currentFloorId ? 'active' : ''}`, 
            textContent: floor.Name 
        });
        
        tab.addEventListener('click', () => {
            if (state.editingOptionPositionId) {
                alert("Please Save or Cancel your current edit before switching floors.");
                return;
            }
            state.currentFloorId = floor.id;
            activeElevationId = null; 
            renderAdminEditor();
        });
        floorTabsContainer.appendChild(tab);
    });
    
    const createBtn = getEl('createOptionSetBtn');
    const newCreateBtn = createBtn.cloneNode(true);
    createBtn.parentNode.replaceChild(newCreateBtn, createBtn);
    
    if(!state.currentFloorId) return;

    const currentFloor = db.Floor.find(f => f.id === state.currentFloorId);
    const isElevationTab = currentFloor && (currentFloor.Name.toLowerCase().includes('elevation') || currentFloor.Name.toLowerCase().includes('exterior'));
    
    newCreateBtn.textContent = isElevationTab ? 'Add Elevation Type' : 'Create New Option Set';
    
    newCreateBtn.addEventListener('click', () => {
         showModal('Create New Option Set', [
            { label: 'Option Set Name', id: 'Name' },
            { label: 'Allow Multiple Selections', id: 'allow_multiple_selections', type: 'checkbox' },
            { label: 'Gear Icon Mode', id: 'icon_mode', type: 'select', options: [
                { value: 'set_level', label: 'Single Icon for Whole Set' },
                { value: 'option_level', label: 'Individual Icon for Each Option' }
            ], value: 'set_level' }
        ]);
         state.modalSaveCallback = async formData => {
            if (formData.Name) {
                formData.BelongsToFloor = state.currentFloorId;
                formData.position = db.OptionSet.filter(os => os.BelongsToFloor === state.currentFloorId).length;
                formData.allow_multiple_selections = !!formData.allow_multiple_selections; 
                formData.icon_mode = formData.icon_mode || 'set_level';
                await data.addOptionSet(formData);
                await loadDataFromSupabase();
                renderAdminEditor();
                hideModal();
            }
         };
    });

    db.OptionSet.filter(os => os.BelongsToFloor === state.currentFloorId).forEach(optionSet => {
        const isOpen = state.openOptionSets.has(optionSet.id);
        
        // EDIT OPTION SET
        const editSetBtn = createElement('button', { type: 'button', className: 'btn-secondary', textContent: 'Edit Set' });
        
        editSetBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // 1. Open the Modal (Category AND Code Removed!)
            showModal('Edit Option Set', [
                { label: 'Set Name', id: 'Name', value: optionSet.Name },
                { label: 'Sort Order', id: 'position', type: 'number', value: optionSet.position },
                { label: 'Allow Multiple Selections?', id: 'allow_multiple_selections', type: 'checkbox', checked: optionSet.allow_multiple_selections },
                { label: 'Icon / Hotspot Mode', id: 'icon_mode', type: 'select', value: optionSet.icon_mode || 'option_level', options: [
                    { value: 'option_level', label: 'Individual Gear for Each Option' },
                    { value: 'set_level', label: 'Single Gear for Whole Set' },
                    { value: 'hidden', label: 'Hidden (No Gear)' }
                ]}
            ], {
                dangerZone: {
                    buttonText: 'Delete Set',
                    callback: () => {
                        if (confirm(`Are you absolutely sure you want to delete the "${optionSet.Name}" set?\n\nWARNING: You must manually delete all individual options inside this set FIRST.`)) {
                            data.deleteOptionSet(optionSet.id).then(async () => {
                                await loadDataFromSupabase();
                                renderAdminEditor();
                                hideModal(); 
                            }).catch(err => {
                                console.error("Deletion failed:", err);
                                alert("Failed to delete set. Ensure ALL options inside this set are deleted first!");
                            });
                        }
                    }
                }
            });
            
            // 2. Define the Save Action
            state.modalSaveCallback = async (formData) => {
                if (formData.Name) {
                    
                    // Force checkboxes to be true/false booleans
                    formData.allow_multiple_selections = !!formData.allow_multiple_selections;
                    
                    
                    // THE FIX: Force position to be a real integer. If it's blank, default to 0.
                    if (formData.position === "" || formData.position === null || formData.position === undefined) {
                        formData.position = 0;
                    } else {
                        formData.position = parseInt(formData.position, 10);
                    }
                    
                    // SAFETY CHECK: Delete the bad key if it's somehow still in the form data
                    if ('allow_multiple' in formData) {
                        delete formData.allow_multiple;
                    }

                    // Save to database using optionSet.id
                    await data.updateOptionSet(optionSet.id, formData);
                    await loadDataFromSupabase();
                    renderAdminEditor();
                    hideModal();
                }
            };
        });


        const headerButtons = [ editSetBtn ]; // <--- We add the new button here!

        // ADJUST GEAR ICON (SET LEVEL)
        if (!isElevationTab && (!optionSet.icon_mode || optionSet.icon_mode === 'set_level')) {
            const adjustGearBtn = createElement('button', { type: 'button', className: 'btn-secondary optionset-gear-btn', textContent: 'Gear Settings' });
            adjustGearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                enterGearEditMode(optionSet.id, 'OptionSet');
                window.scrollTo(0, 0);
            });
            headerButtons.push(adjustGearBtn);
        }
        
        // LAYER ORDER
        if (optionSet.allow_multiple_selections) {
            const layerBtn = createElement('button', { type: 'button', className: 'btn-secondary optionset-layer-btn', textContent: 'Set Layer Order' });
            layerBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const options = db.Option.filter(o => o.BelongsToOptionSet === optionSet.id).sort((a, b) => (a.layer_order ?? 0) - (b.layer_order ?? 0));
                const items = options.map(o => ({ id: o.id, text: o.Name }));
                showSortableListModal(`Set Layer Order for ${optionSet.Name}`, items, async (orderedIds) => {
                    const updates = orderedIds.map((id, index) => ({ id: parseInt(id), layer_order: index }));
                    await data.updatePositions('Option', updates);
                    hideModal();
                    await loadDataFromSupabase();
                    renderAdminEditor();
                });
            });
            headerButtons.unshift(layerBtn);
        }

        // CHECK FOR MISSING MASTER GEAR
        const needsSetGear = (!isElevationTab && (!optionSet.icon_mode || optionSet.icon_mode === 'set_level') && optionSet.Gear_X === null);
        
        // THE FIX: Added flexbox to vertically align the new red badge with the text!
        const headerText = createElement('h4', { textContent: optionSet.Name, style: 'display: flex; align-items: center;' });
        
        if (needsSetGear) {
            headerText.innerHTML = `${optionSet.Name} <span style="background: #dc3545; color: white; border-radius: 50%; width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; font-weight: 900; font-size: 13px; margin-left: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);" title="Missing Master Gear Icon">!</span>`;
        }

        const header = createElement('div', { className: 'option-set-header' }, [
            headerText,
            createElement('div', {className: 'option-set-header-actions' }, headerButtons)
        ]);
        
        const thumbnailsContainer = createElement('div', { className: `option-thumbnails ${isOpen ? '' : 'hidden'}`, 'data-sortable-id': optionSet.id });
        
        db.Option.filter(o => o.BelongsToOptionSet === optionSet.id).forEach(option => {
            
            const isPatch = option.is_system_patch === true;
            const needsOptGear = !isPatch && !isElevationTab && (optionSet.icon_mode === 'option_level') && option.Gear_X === null;

            // ==========================================
            // BUILD THE "ACTIONS" DROPDOWN MENU
            // ==========================================
            const actionsContainer = createElement('div', { className: 'option-actions-container' });
            
            const actionsBtn = createElement('button', { 
                type: 'button', 
                className: 'option-actions-btn' 
            }, [
                createElement('span', { style: 'width: 16px;' }),
                createElement('span', { textContent: 'Manage Option' }),
                createElement('span', { textContent: '▼', style: 'font-size: 0.7rem;' })
            ]);
            
            const actionsDropdown = createElement('div', { className: 'option-dropdown' });

            // 1. EDIT OPTION DETAILS
            const editOptBtn = createElement('button', { type: 'button', textContent: 'Edit Details' });
            editOptBtn.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                closeAllOptionDropdowns(); // <--- FIX: Closes menu before modal opens!
                
                const allOptions = getAllOptionsForSelect(option.id);
                showModal('Edit Option Details', [
                    { label: 'Option Name', id: 'Name', value: option.Name },
                    { label: 'Option Code', id: 'code', value: option.code || '' },
                    { label: 'Description (Optional)', id: 'Description', value: option.Description || '' },
                    { label: 'Is Default (Standard Feature)?', id: 'is_default', type: 'checkbox', checked: option.is_default },
                    { label: 'Is System Patch (Hidden from client)', id: 'is_system_patch', type: 'checkbox', checked: isPatch },
                    { label: 'Hide from Review & Brochure', id: 'hide_in_review', type: 'checkbox', checked: !!option.hide_in_review },
                    { label: 'Auto-Trigger Options', id: 'trigger_options', type: 'choices-multiple', options: allOptions, values: option.trigger_options || [], hidden: !isPatch },
                    { label: 'New Thumbnail (Optional)', id: 'Thumbnail', type: 'file', existingValue: option.Thumbnail },
                    { label: 'New Overlay Image (Optional)', id: 'OptionImage', type: 'file', existingValue: option.OptionImage },
                    { label: 'Requirements', id: 'requirements', type: 'choices-multiple', options: allOptions, values: option.requirements },
                    { label: 'Conflicts', id: 'conflicts', type: 'choices-multiple', options: allOptions, values: option.conflicts }
                ]);
                
                state.modalSaveCallback = async (formData, rawForm) => {
                    let reqs = [], confs = [], triggers = [];
                    if (rawForm instanceof FormData) {
                        reqs = rawForm.getAll('requirements').map(val => parseInt(val));
                        confs = rawForm.getAll('conflicts').map(val => parseInt(val));
                        triggers = rawForm.getAll('trigger_options').map(val => parseInt(val));
                    }
                    await data.updateOption(option.id, {
                        ...formData,
                        is_default: !!formData.is_default,
                        is_system_patch: !!formData.is_system_patch,
                        hide_in_review: !!formData.hide_in_review,
                        trigger_options: triggers,
                        requirements: reqs,
                        conflicts: confs
                    });
                    await loadDataFromSupabase();
                    renderAdminEditor();
                    hideModal();
                };
            });
            actionsDropdown.appendChild(editOptBtn);

            // 2. CROP THUMBNAIL 
            const cropThumbBtn = createElement('button', { type: 'button', textContent: 'Crop Thumbnail' });
            cropThumbBtn.addEventListener('click', (e) => { 
                e.preventDefault(); e.stopPropagation(); 
                closeAllOptionDropdowns(); // <--- FIX
                handleThumbnailCrop(option); 
            });
            actionsDropdown.appendChild(cropThumbBtn);

            // 3. ADJUST OVERLAY (Only if NOT Elevation Tab)
            if (!isElevationTab) {
                const adjustBtn = createElement('button', { type: 'button', textContent: 'Adjust Overlay' });
                adjustBtn.addEventListener('click', (e) => {
                    e.preventDefault(); e.stopPropagation();
                    closeAllOptionDropdowns(); // <--- FIX
                    enterPositionEditMode(option.id);
                    window.scrollTo(0, 0);
                });
                actionsDropdown.appendChild(adjustBtn);

                // 4. ADJUST GEAR ICON 
                if (optionSet.icon_mode === 'option_level') {
                    const adjustOptGearBtn = createElement('button', { 
                        type: 'button', 
                        textContent: isPatch ? 'Patch (No Gear Needed)' : 'Gear Settings',
                        disabled: isPatch
                    });
                    if (!isPatch) {
                        adjustOptGearBtn.addEventListener('click', (e) => {
                            e.preventDefault(); e.stopPropagation();
                            closeAllOptionDropdowns(); // <--- FIX
                            enterGearEditMode(option.id, 'Option');
                            window.scrollTo(0, 0);
                        });
                    }
                    actionsDropdown.appendChild(adjustOptGearBtn);
                }
            }

            // 5. MANAGE GALLERY
            const galleryBtn = createElement('button', { type: 'button', textContent: 'Manage Gallery' });
            galleryBtn.addEventListener('click', (e) => { 
                e.preventDefault(); e.stopPropagation(); 
                closeAllOptionDropdowns(); // <--- FIX
                openGalleryManager(option.id); 
            });
            actionsDropdown.appendChild(galleryBtn);

            // 6. DELETE OPTION
            const deleteBtn = createElement('button', { type: 'button', className: 'text-danger', textContent: 'Delete Option' });
            deleteBtn.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                closeAllOptionDropdowns(); // <--- FIX
                if (confirm(`Delete option "${option.Name}"?`)) {
                    data.deleteOption(option.id).then(() => {
                        loadDataFromSupabase().then(renderAdminEditor);
                    });
                }
            });
            actionsDropdown.appendChild(deleteBtn);

            // 7. ASSEMBLE THE MENU
            actionsContainer.append(actionsBtn, actionsDropdown);

            // ==========================================
            // BUILD THE THUMBNAIL ITEM & WRAPPER
            // ==========================================
            const thumbItem = createElement('div', { className: 'option-thumbnail-item', style: 'position: relative;' }, [ 
                createElement('img', { src: option.Thumbnail, alt: option.Name }) 
            ]);
            
            if (needsOptGear) {
                thumbItem.appendChild(createElement('div', { 
                    style: 'position: absolute; top: 6px; right: 6px; background: #dc3545; color: white; border-radius: 50%; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 14px; box-shadow: 0 2px 4px rgba(0,0,0,0.3); z-index: 10;',
                    title: 'Missing Gear Icon', 
                    textContent: '!' 
                }));
            }

            const cardElements = [
                thumbItem,
                createElement('div', { className: 'admin-thumbnail-name', style: 'font-size: 1rem !important; font-weight: 800 !important; color: #000; margin-top: 8px; margin-bottom: 4px;', textContent: option.Name })
            ];
            if (option.code) {
                cardElements.push(createElement('div', { style: 'font-size:0.75rem; color:#666; margin-bottom: 4px;', textContent: `Code: ${option.code}` }));
            }
            if (isPatch) {
                cardElements.push(createElement('div', { style: 'font-size:0.75rem; color:var(--primary-color); font-weight:bold; margin-bottom: 4px;', textContent: 'System Patch' }));
            }
            cardElements.push(actionsContainer);

            const wrapper = createElement('div', { className: 'admin-thumbnail-wrapper', 'data-id': option.id }, cardElements);

            // ==========================================
            // THE SMART MENU LOGIC (Flip Up vs Drop Down)
            // ==========================================
            actionsBtn.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                
                const isCurrentlyOpen = actionsDropdown.classList.contains('show');
                closeAllOptionDropdowns(); // Wipe the slate clean
                if (isCurrentlyOpen) return; // If we clicked the button just to close it, stop here

                // Assign IDs so it knows how to return home
                if (!actionsDropdown.id) actionsDropdown.id = 'dd-' + Math.random().toString(36).substr(2, 9);
                if (!actionsContainer.id) actionsContainer.id = 'orig-' + Math.random().toString(36).substr(2, 9);
                actionsDropdown.setAttribute('data-origin', actionsContainer.id);

                // Move to body for complete layout freedom
                document.body.appendChild(actionsDropdown);
                
                // Show it immediately so we can measure it
                actionsDropdown.classList.add('show');
                
                const rect = actionsBtn.getBoundingClientRect();
                const ddRect = actionsDropdown.getBoundingClientRect();
                const windowHeight = window.innerHeight;

                // SMART PLACEMENT: Will it hit the bottom of the screen?
                if (rect.bottom + ddRect.height + 10 > windowHeight) {
                    // Not enough room! Flip it UP above the button.
                    actionsDropdown.style.top = `${rect.top - ddRect.height - 5}px`;
                } else {
                    // Plenty of room. Drop it DOWN below the button.
                    actionsDropdown.style.top = `${rect.bottom + 5}px`;
                }
                
                actionsDropdown.style.left = `${rect.left}px`;
                actionsDropdown.style.width = `${rect.width}px`;
            });

            if (isElevationTab) {
                wrapper.addEventListener('click', (e) => {
                    if (e.target.closest('button') || e.target.closest('.option-actions-container')) return; 
                    activeElevationId = option.id; 
                    document.querySelectorAll('.admin-thumbnail-wrapper').forEach(el => el.querySelector('.option-thumbnail-item').classList.remove('selected'));
                    wrapper.querySelector('.option-thumbnail-item').classList.add('selected');
                    renderAdminCanvas(); 
                });
                if (activeElevationId === option.id) {
                    wrapper.querySelector('.option-thumbnail-item').classList.add('selected');
                }
            }

            thumbnailsContainer.appendChild(wrapper);
        });
        
        // ADD NEW OPTION (Inside Set)
        const addOptionBtn = createElement('button', { type: 'button', className: 'option-add-btn', textContent: '+ Add New Option' });
        addOptionBtn.addEventListener('click', () => {
            const allOptions = getAllOptionsForSelect();
            showModal('Create New Option', [
                { label: 'Option Name', id: 'Name' }, 
                { label: 'Option Code (Optional)', id: 'code' },
                { label: 'Description (Optional)', id: 'Description' },
                { label: 'Is System Patch (Hidden from client)', id: 'is_system_patch', type: 'checkbox', checked: false },
                { label: 'Hide from Review & Brochure', id: 'hide_in_review', type: 'checkbox', checked: false },
                { label: 'Auto-Trigger Options', id: 'trigger_options', type: 'choices-multiple', options: allOptions, hidden: true },
                { label: 'Thumbnail Image (4:3 recommended)', id: 'Thumbnail', type: 'file' }, 
                { label: 'Main Overlay Image', id: 'OptionImage', type: 'file' },
                { label: 'Requirements (Must have one of these)', id: 'requirements', type: 'choices-multiple', options: allOptions },
                { label: 'Conflicts (Cannot select if one of these is active)', id: 'conflicts', type: 'choices-multiple', options: allOptions }
            ]);
            
            state.modalSaveCallback = async (formData, rawForm) => {
                let reqs = [], confs = [], triggers = [];
                if (rawForm instanceof FormData) {
                    reqs = rawForm.getAll('requirements').map(val => parseInt(val));
                    confs = rawForm.getAll('conflicts').map(val => parseInt(val));
                    triggers = rawForm.getAll('trigger_options').map(val => parseInt(val));
                }

                if (formData.Name && formData.Thumbnail && formData.OptionImage) { 
                    const newOpt = {
                        ...formData,
                        is_system_patch: !!formData.is_system_patch,
                        hide_in_review: !!formData.hide_in_review,
                        trigger_options: triggers,
                        requirements: reqs,
                        conflicts: confs,
                        BelongsToOptionSet: optionSet.id,
                        position: db.Option.filter(o => o.BelongsToOptionSet === optionSet.id).length,
                        X_Position: 10, Y_Position: 10, Width: 20, Height: 20 
                    };
                    await data.addOption(newOpt);
                    await loadDataFromSupabase();
                    renderAdminEditor(); 
                    hideModal();
                } else {
                    alert('Please provide a name and both images.');
                }
            };
        });

        thumbnailsContainer.appendChild(addOptionBtn);
        const group = createElement('div', { className: `option-set-group ${isOpen ? 'open' : ''}`, 'data-id': optionSet.id }, [header, thumbnailsContainer]);
        
        header.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            state.openOptionSets.has(optionSet.id) ? state.openOptionSets.delete(optionSet.id) : state.openOptionSets.add(optionSet.id);
            group.classList.toggle('open');
            thumbnailsContainer.classList.toggle('hidden');
        });
        optionSetsContainer.appendChild(group);
    });
}

// --- GALLERY MANAGER (UPDATED: DRAGGABLE PACKAGES) ---
// --- GALLERY MANAGER (UPDATED: DRAGGABLE PACKAGES & FIXED EVENTS) ---
function openGalleryManager(optionId) {
    const option = db.Option.find(o => o.id === optionId);
    let galleryImages = [];
    try {
        galleryImages = typeof option.gallery_images === 'string' 
            ? JSON.parse(option.gallery_images) 
            : (option.gallery_images || []);
    } catch (err) { galleryImages = []; }

    // Normalize
    galleryImages = galleryImages.map(img => typeof img === 'string' ? { url: img, group: 'Uncategorized', description: '' } : img);
    galleryImages.forEach(img => { if(!img.group) img.group = 'Uncategorized'; });

    let wrapper; // Declare in wider scope so sync function can access it

    // HELPER: Scrape the DOM to lock in the exact visual order of packages and images
    const syncGalleryStateFromDOM = () => {
        if (!wrapper || !wrapper.parentNode) return; 
        const newState = [];
        wrapper.querySelectorAll('.package-section').forEach(section => {
            const groupName = section.querySelector('.package-title').textContent;
            const items = section.querySelectorAll('.modal-gallery-item');
            
            if (items.length === 0) {
                // Keep empty packages alive
                newState.push({ url: 'placeholder', group: groupName, description: '', isPlaceholder: true });
            } else {
                items.forEach(item => {
                    const url = item.getAttribute('data-url');
                    const descInput = item.querySelector('.gallery-desc-input');
                    const desc = descInput ? descInput.value : '';
                    newState.push({ url, group: groupName, description: desc });
                });
            }
        });
        galleryImages = newState;
    };

    // RENDER FUNCTION FOR THE MODAL CONTENT
    const renderModalContent = () => {
        wrapper = createElement('div', { className: 'admin-gallery-wrapper' });
        
        // Extract groups in the exact order they appear in the array
        const orderedGroups = [];
        galleryImages.forEach(img => {
            if (!orderedGroups.includes(img.group)) orderedGroups.push(img.group);
        });
        // Removed the forceful creation of the 'Uncategorized' section!

        // Render Package Sections in that specific order
        orderedGroups.forEach(pkgName => {
            const isUncat = pkgName === 'Uncategorized';
            const section = createElement('div', { className: 'package-section', 'data-group': pkgName });
            
            // --- FIX 1: PROPERLY WIRE UPLOAD EVENTS ---
            const uploadBtn = createElement('button', { type: 'button', className: 'package-upload-btn-label', textContent: '+ Upload Here' });
            const fileInput = createElement('input', { type: 'file', className: 'hidden-pkg-input', multiple: 'true', style: 'display:none' });
            
            uploadBtn.addEventListener('click', () => fileInput.click());
            // --- FIX 1: BULLETPROOF UPLOAD EVENTS ---
            fileInput.addEventListener('change', async (e) => {
                if (e.target.files.length > 0) {
                    syncGalleryStateFromDOM(); // Lock in drag changes before re-rendering
                    
                    // Show visual feedback so you know it didn't freeze
                    uploadBtn.textContent = 'Uploading...';
                    uploadBtn.disabled = true;
                    uploadBtn.style.opacity = '0.7';

                    try {
                        // We verified data.uploadImage is your correct function name
                        const newUrls = await Promise.all(Array.from(e.target.files).map(f => data.uploadImage(f)));
                        newUrls.forEach(url => {
                            if(url) galleryImages.push({ url, group: pkgName, description: '' });
                        });
                    } catch (err) {
                        console.error("Upload failed:", err);
                        alert("Failed to upload the image. Check console for details.");
                    }

                    renderModalContent(); // Instantly redraws the modal to show your new image!
                }
            });

            // --- FIX 2: PROPERLY WIRE HEADER BUTTONS ---
            const headerActions = [];
            if (!isUncat) {
                const renameBtn = createElement('button', { type: 'button', className: 'btn-secondary', textContent: 'Rename', style: 'padding:5px 10px; font-size:0.8rem; margin-right:5px;' });
                renameBtn.addEventListener('click', () => {
                    const newName = prompt("Enter new package name:", pkgName);
                    if (newName && newName !== pkgName) {
                        syncGalleryStateFromDOM();
                        galleryImages.forEach(img => { if(img.group === pkgName) img.group = newName; });
                        renderModalContent();
                    }
                });

                const deleteBtn = createElement('button', { type: 'button', className: 'btn-danger', textContent: 'Delete', style: 'padding:5px 10px; font-size:0.8rem;' });
                deleteBtn.addEventListener('click', () => {
                    if(confirm(`Delete package "${pkgName}" and all its images?`)) {
                        syncGalleryStateFromDOM();
                        galleryImages = galleryImages.filter(img => img.group !== pkgName);
                        renderModalContent();
                    }
                });
                headerActions.push(renameBtn, deleteBtn);
            }

            const dragHandle = !isUncat ? createElement('span', { className: 'material-symbols-outlined pkg-drag-handle', textContent: 'drag_indicator', style: 'cursor:grab; color:#ccc; margin-right:10px; user-select:none;' }) : null;
            const pkgTitle = createElement('span', { className: 'package-title', textContent: pkgName, style: 'margin-right:15px;' });

            const headerLeftElems = dragHandle ? [dragHandle, pkgTitle, uploadBtn, fileInput] : [pkgTitle, uploadBtn, fileInput];
            const headerLeft = createElement('div', { style: 'display:flex; align-items:center;' }, headerLeftElems);
            const headerRight = createElement('div', {}, headerActions);

            const header = createElement('div', { className: 'package-header' }, [headerLeft, headerRight]);
            const dropZone = createElement('div', { className: 'package-drop-zone', 'data-group': pkgName });
            
            // Render items for this package
            const packageItems = galleryImages.filter(img => img.group === pkgName);
            packageItems.forEach((imgObj) => {
                if (imgObj.isPlaceholder) return;
                
                // --- FIX 3: PROPERLY WIRE ITEM INPUTS & BUTTONS ---
                const descInput = createElement('input', { type: 'text', placeholder: 'Description', value: imgObj.description || '', className: 'gallery-desc-input' });
                descInput.addEventListener('input', (e) => { imgObj.description = e.target.value; });

                const delBtn = createElement('button', { type: 'button', className: 'gallery-delete-btn', textContent: '×' });
                delBtn.addEventListener('click', () => {
                    syncGalleryStateFromDOM();
                    
                    // FIXED: Compare the exact URL string instead of the object memory reference
                    galleryImages = galleryImages.filter(i => i.url !== imgObj.url); 
                    
                    renderModalContent();
                });

                const item = createElement('div', { className: 'modal-gallery-item', 'data-url': imgObj.url }, [
                    createElement('img', { src: imgObj.url }),
                    descInput,
                    delBtn
                ]);
                dropZone.append(item);
            });

            section.append(header, dropZone);
            wrapper.append(section);
        });

        // --- FIX 4: ADD PACKAGE BUTTON STYLING & EVENT ---
        const addPkgBtn = createElement('button', { type: 'button', className: 'btn-primary', textContent: '+ Add New Package', style: 'margin-top: 10px; width: 100%;' });
        addPkgBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const name = prompt("Enter Package Name:");
            if (name) {
                syncGalleryStateFromDOM();
                galleryImages.push({ url: 'placeholder', group: name, description: '', isPlaceholder: true });
                renderModalContent();
            }
        });
        
        wrapper.append(addPkgBtn);

        const modalContent = getEl('modal').querySelector('.modal-content');
        const form = getEl('modalForm');
        form.innerHTML = '';
        form.append(wrapper);

        // MAKE THE PACKAGES THEMSELVES SORTABLE
        new Sortable(wrapper, {
            animation: 150,
            handle: '.pkg-drag-handle', // Only drag by the icon
            filter: '.btn-primary', // Exclude the new package button from being dragged
        });

        // Keep the inner image sortables
        const zones = wrapper.querySelectorAll('.package-drop-zone');
        zones.forEach(zone => {
            new Sortable(zone, {
                group: 'gallery-shared',
                animation: 150
            });
        });
    };

    // OPEN MODAL
    showModal(`Manage Gallery: ${option.Name}`, [], { modalClass: 'gallery-manager-modal' });
    renderModalContent();

    // OVERRIDE SAVE CALLBACK
    state.modalSaveCallback = async () => {
        syncGalleryStateFromDOM(); // Read the final visual order top-to-bottom
        
        // DO NOT filter out placeholders! Keep them so empty packages survive the save process.
        const finalGallery = galleryImages; 

        await data.updateOption(optionId, { gallery_images: JSON.stringify(finalGallery) });
        await loadDataFromSupabase();
        renderAdminEditor();
        hideModal();
    };
}

export function initSortables() {
    if (optionSetSortable) optionSetSortable.destroy();
    optionSortables.forEach(s => s.destroy());
    optionSortables = [];

    const optionSetsContainer = getEl('adminOptionSetsContainer');
    if (!optionSetsContainer) return;
    optionSetSortable = new Sortable(optionSetsContainer, {
        animation: 150,
        handle: '.option-set-header',
        onEnd: async (evt) => {
            const items = Array.from(evt.to.children).map(el => el.dataset.id);
            const updates = items.map((id, index) => ({ id: parseInt(id), position: index }));
            await data.updatePositions('OptionSet', updates);
            await loadDataFromSupabase();
            renderAdminEditor();
        },
    });

    document.querySelectorAll('.option-thumbnails').forEach(container => {
        const sortable = new Sortable(container, {
            animation: 150,
            filter: '.option-add-btn',
            onEnd: async (evt) => {
                const items = Array.from(evt.to.children).filter(el => el.classList.contains('admin-thumbnail-wrapper')).map(el => el.dataset.id);
                const updates = items.map((id, index) => ({ id: parseInt(id), position: index }));
                await data.updatePositions('Option', updates);
                await loadDataFromSupabase();
                renderAdminEditor();
            },
        });
        optionSortables.push(sortable);
    });
}