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

        // --- FIXED SAVE BUTTON (Closure Logic) ---
        const saveBtn = createElement('button', { 
            type: 'button', 
            id: 'savePosBtn', 
            textContent: 'Save Position', 
            style: 'flex:1;' 
        });
        
        const cancelBtn = createElement('button', { 
            type: 'button', 
            id: 'cancelPosBtn', 
            className: 'btn-secondary', 
            textContent: 'Cancel', 
            style: 'flex:1;' 
        });

        saveBtn.addEventListener('click', async () => {
            if (!adminFabricCanvas || !adminFabricCanvas.bgMetrics) return;
            
            // Find object by ID (Reliable)
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
                
                // Update Local Store
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

        cancelBtn.addEventListener('click', () => {
            exitPositionEditMode();
        });

        controls.append(
            createElement('h4', { textContent: `Editing: ${option.Name}`, style: 'margin-bottom:10px; color: var(--primary-color);' }),
            createElement('p', { textContent: 'Drag to move. Drag corners to resize.', style: 'font-size:0.9rem; color:#666; margin-bottom:15px;' }),
            opacityContainer,
            createElement('div', { style: 'display:flex; gap:10px;' }, [ saveBtn, cancelBtn ])
        );
        controls.classList.remove('hidden');
        
        getEl('adminEditor').querySelector('.controls-column').querySelectorAll('button:not(#savePosBtn):not(#cancelPosBtn), a').forEach(el => { 
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
    db.ModelHome.map(model => {
        const card = createElement('a', { className: 'model-home-card', 'data-model-id': model.id, href: '#' }, [
            createElement('img', { src: model.CoverImage, alt: model.Name, className: 'model-home-card-image' }),
            createElement('div', { className: 'model-home-card-name', textContent: model.Name })
        ]);
        card.addEventListener('click', e => { 
            e.preventDefault(); 
            initAdminModelManagement(model.id); 
        });
        return card;
    }).forEach(card => grid.append(card));
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
            { label: 'Allow Multiple Selections', id: 'allow_multiple_selections', type: 'checkbox' }
        ]);
         state.modalSaveCallback = async formData => {
            if (formData.Name) {
                formData.BelongsToFloor = state.currentFloorId;
                formData.position = db.OptionSet.filter(os => os.BelongsToFloor === state.currentFloorId).length;
                formData.allow_multiple_selections = !!formData.allow_multiple_selections; 
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
        const editSetBtn = createElement('button', { type: 'button', className: 'btn-secondary optionset-edit-btn', textContent: 'Edit' });
        editSetBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const set = db.OptionSet.find(s => s.id === optionSet.id);
            showModal('Edit Option Set', [
                { label: 'Set Name', id: 'Name', value: set.Name },
                { label: 'Allow Multiple Selections', id: 'allow_multiple_selections', type: 'checkbox', checked: set.allow_multiple_selections }
            ]);
            state.modalSaveCallback = async (formData) => {
                if(formData.Name) {
                    await data.updateOptionSet(optionSet.id, { 
                        Name: formData.Name, 
                        allow_multiple_selections: !!formData.allow_multiple_selections 
                    });
                    await loadDataFromSupabase();
                    renderAdminEditor();
                    hideModal();
                }
            };
        });

        const headerButtons = [ editSetBtn ];
        
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

        const header = createElement('div', { className: 'option-set-header' }, [
            createElement('h4', { textContent: optionSet.Name }),
            createElement('div', {className: 'option-set-header-actions' }, headerButtons)
        ]);
        
        const thumbnailsContainer = createElement('div', { className: `option-thumbnails ${isOpen ? '' : 'hidden'}`, 'data-sortable-id': optionSet.id });
        
        db.Option.filter(o => o.BelongsToOptionSet === optionSet.id).forEach(option => {
            
            // EDIT OPTION DETAILS
            const editOptBtn = createElement('button', { type: 'button', className: 'btn-secondary option-edit-btn', textContent: 'Edit Details' });
            editOptBtn.addEventListener('click', () => {
                const allOptions = getAllOptionsForSelect(option.id);
                showModal('Edit Option Details', [
                    { label: 'Option Name', id: 'Name', value: option.Name },
                    { label: 'Option Code', id: 'code', value: option.code || '' },
                    { label: 'New Thumbnail (Optional)', id: 'Thumbnail', type: 'file', existingValue: option.Thumbnail },
                    { label: 'New Overlay Image (Optional)', id: 'OptionImage', type: 'file', existingValue: option.OptionImage },
                    { label: 'Requirements', id: 'requirements', type: 'checkbox-group', options: allOptions, values: option.requirements },
                    { label: 'Conflicts', id: 'conflicts', type: 'checkbox-group', options: allOptions, values: option.conflicts }
                ]);
                
                state.modalSaveCallback = async (formData, rawForm) => {
                    let reqs = [], confs = [];
                    if (rawForm instanceof FormData) {
                        reqs = rawForm.getAll('requirements').map(val => parseInt(val));
                        confs = rawForm.getAll('conflicts').map(val => parseInt(val));
                    }
                    await data.updateOption(option.id, {
                        ...formData,
                        requirements: reqs,
                        conflicts: confs
                    });
                    await loadDataFromSupabase();
                    renderAdminEditor();
                    hideModal();
                };
            });

            // MANAGE GALLERY
            const galleryBtn = createElement('button', { type: 'button', className: 'btn-secondary option-gallery-btn', textContent: 'Manage Gallery' });
            galleryBtn.addEventListener('click', () => openGalleryManager(option.id));

            // DELETE OPTION
            const deleteBtn = createElement('button', { type: 'button', className: 'btn-danger option-delete-btn', textContent: 'Delete' });
            deleteBtn.addEventListener('click', () => {
                if (confirm(`Delete option "${option.Name}"?`)) {
                    data.deleteOption(option.id).then(() => {
                        loadDataFromSupabase().then(renderAdminEditor);
                    });
                }
            });

            const actions = [ editOptBtn, galleryBtn ];
            
            // ADJUST POSITION
            if (!isElevationTab) {
                const adjustBtn = createElement('button', { type: 'button', className: 'option-adjust-btn', textContent: 'Adjust Position' });
                adjustBtn.addEventListener('click', () => {
                    enterPositionEditMode(option.id);
                    window.scrollTo(0, 0);
                });
                actions.push(adjustBtn);
            }
            
            actions.push(deleteBtn);

            const wrapper = createElement('div', { className: 'admin-thumbnail-wrapper', 'data-id': option.id }, [
                createElement('div', { className: 'option-thumbnail-item' }, [ createElement('img', { src: option.Thumbnail, alt: option.Name }) ]),
                createElement('div', { className: 'admin-thumbnail-name', textContent: option.Name }),
                createElement('div', { style: 'font-size:0.7rem; color:#666;', textContent: option.code ? `Code: ${option.code}` : '' }),
                createElement('div', { className: 'admin-thumbnail-actions' }, actions)
            ]);
            
            if (isElevationTab) {
                wrapper.addEventListener('click', (e) => {
                    if (e.target.closest('button')) return; 
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
                { label: 'Thumbnail Image (4:3 recommended)', id: 'Thumbnail', type: 'file' }, 
                { label: 'Main Overlay Image', id: 'OptionImage', type: 'file' },
                { label: 'Requirements (Must have one of these)', id: 'requirements', type: 'checkbox-group', options: allOptions },
                { label: 'Conflicts (Cannot select if one of these is active)', id: 'conflicts', type: 'checkbox-group', options: allOptions }
            ]);
            
            state.modalSaveCallback = async (formData, rawForm) => {
                let reqs = [], confs = [];
                if (rawForm instanceof FormData) {
                    reqs = rawForm.getAll('requirements').map(val => parseInt(val));
                    confs = rawForm.getAll('conflicts').map(val => parseInt(val));
                }

                if (formData.Name && formData.Thumbnail && formData.OptionImage) { 
                    const newOpt = {
                        ...formData,
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

// --- GALLERY MANAGER (FIXED: BUTTON BINDING) ---
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
    // Ensure group exists
    galleryImages.forEach(img => { if(!img.group) img.group = 'Uncategorized'; });

    // RENDER FUNCTION FOR THE MODAL CONTENT
    const renderModalContent = () => {
        const wrapper = createElement('div', { className: 'admin-gallery-wrapper' });
        
        // 1. Group Images by Package
        const packages = {};
        galleryImages.forEach(img => {
            // FIX: DO NOT SKIP PLACEHOLDERS. We need them to generate headers.
            if (!packages[img.group]) packages[img.group] = [];
            packages[img.group].push(img);
        });

        if (!packages['Uncategorized']) packages['Uncategorized'] = [];

        // 2. Render Package Sections
        Object.keys(packages).sort((a,b) => a === 'Uncategorized' ? -1 : 1).forEach(pkgName => {
            const isUncat = pkgName === 'Uncategorized';
            const section = createElement('div', { className: 'package-section' });
            
            const header = createElement('div', { className: 'package-header' }, [
                createElement('div', { style: 'display:flex; align-items:center;' }, [
                    createElement('span', { className: 'package-title', textContent: pkgName, style: 'margin-right:15px;' }),
                    // Direct Upload Button
                    createElement('button', { 
                        type: 'button',
                        className: 'package-upload-btn-label',
                        textContent: '+ Upload Here',
                        onclick: () => {
                            const input = section.querySelector('.hidden-pkg-input');
                            if(input) input.click();
                        }
                    }),
                    createElement('input', { 
                        type: 'file', 
                        className: 'hidden-pkg-input',
                        multiple: true, 
                        style: 'display:none',
                        onchange: async (e) => {
                            if (e.target.files.length > 0) {
                                const newUrls = await Promise.all(Array.from(e.target.files).map(f => data.uploadImage(f)));
                                newUrls.forEach(url => {
                                    if(url) galleryImages.push({ url, group: pkgName, description: '' });
                                });
                                renderModalContent();
                            }
                        }
                    })
                ]),
                createElement('div', {}, [
                    !isUncat ? createElement('button', { 
                        type: 'button', className: 'btn-secondary', textContent: 'Rename', style: 'padding:5px 10px; font-size:0.8rem; margin-right:5px;',
                        onclick: () => {
                            const newName = prompt("Enter new package name:", pkgName);
                            if (newName && newName !== pkgName) {
                                galleryImages.forEach(img => { if(img.group === pkgName) img.group = newName; });
                                renderModalContent();
                            }
                        }
                    }) : null,
                    !isUncat ? createElement('button', { 
                        type: 'button', className: 'btn-danger', textContent: 'Delete', style: 'padding:5px 10px; font-size:0.8rem;',
                        onclick: () => {
                            if(confirm(`Delete package "${pkgName}" and all its images?`)) {
                                galleryImages = galleryImages.filter(img => img.group !== pkgName);
                                renderModalContent();
                            }
                        }
                    }) : null
                ])
            ]);

            const dropZone = createElement('div', { className: 'package-drop-zone', 'data-group': pkgName });
            
            packages[pkgName].forEach((imgObj, idx) => {
                // FIX: FILTER OUT PLACEHOLDERS FROM THE DROPZONE SO NO BROKEN IMAGE
                if (imgObj.isPlaceholder) return;

                const item = createElement('div', { className: 'modal-gallery-item', 'data-url': imgObj.url }, [
                    createElement('img', { src: imgObj.url }),
                    createElement('input', { type: 'text', placeholder: 'Description', value: imgObj.description || '', className: 'gallery-desc-input', oninput: (e) => { imgObj.description = e.target.value; } }),
                    createElement('button', { type: 'button', className: 'gallery-delete-btn', textContent: '×', onclick: () => {
                        galleryImages = galleryImages.filter(i => i !== imgObj);
                        renderModalContent();
                    }})
                ]);
                dropZone.append(item);
            });

            section.append(header, dropZone);
            wrapper.append(section);
        });

        // --- FIXED: ADD PACKAGE BUTTON (Standard JS) ---
        const addPkgBtn = document.createElement('button');
        addPkgBtn.type = 'button';
        addPkgBtn.textContent = '+ Add New Package';
        addPkgBtn.style.marginTop = '10px';
        addPkgBtn.style.width = '100%';
        addPkgBtn.className = 'button'; 
        
        // Explicitly attach listener
        addPkgBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const name = prompt("Enter Package Name:");
            if (name) {
                // Add placeholder to list to trigger the group creation
                galleryImages.push({ 
                    url: 'placeholder', 
                    group: name, 
                    description: '', 
                    isPlaceholder: true 
                });
                renderModalContent();
            }
        });
        
        wrapper.append(addPkgBtn);

        const modalContent = getEl('modal').querySelector('.modal-content');
        const form = getEl('modalForm');
        form.innerHTML = '';
        form.append(wrapper);

        // 6. Init Sortables for Drag & Drop
        const zones = wrapper.querySelectorAll('.package-drop-zone');
        zones.forEach(zone => {
            new Sortable(zone, {
                group: 'gallery-shared', // Allow dragging between lists
                animation: 150,
                onEnd: (evt) => {
                    const itemUrl = evt.item.dataset.url;
                    const newGroup = evt.to.dataset.group;
                    // Find image in data and update group
                    const img = galleryImages.find(i => i.url === itemUrl);
                    if (img) img.group = newGroup;
                }
            });
        });
    };

    // OPEN MODAL
    showModal(`Manage Gallery: ${option.Name}`, [], { modalClass: 'gallery-manager-modal' });
    renderModalContent();

    // OVERRIDE SAVE CALLBACK
    state.modalSaveCallback = async () => {
        // 1. Clean up placeholders before saving
        const finalGallery = galleryImages.filter(img => !img.isPlaceholder && img.url !== 'placeholder');

        // 2. Save
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