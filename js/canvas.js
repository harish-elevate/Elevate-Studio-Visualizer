import { state, db } from './state.js';
import { getEl, createElement } from './ui.js';

let fabricCanvas = null;
let lastFloorId = null;

// History Stack
let history = [];
let historyIndex = -1;
let isHistoryProcessing = false;

function saveHistory() {
    if (isHistoryProcessing || !fabricCanvas) return;
    const json = fabricCanvas.toObject(['isOverlay']);
    delete json.backgroundImage; 
    const markupOnly = { ...json, objects: json.objects.filter(o => !o.isOverlay) };
    
    if (historyIndex < history.length - 1) history = history.slice(0, historyIndex + 1);
    history.push(JSON.stringify(markupOnly));
    historyIndex++;
    updateHistoryButtons();
}

function updateHistoryButtons() {
    const undoBtn = getEl('undoBtn');
    const redoBtn = getEl('redoBtn');
    if(undoBtn) undoBtn.disabled = historyIndex <= 0;
    if(redoBtn) redoBtn.disabled = historyIndex >= history.length - 1;
}

function undo() {
    if (historyIndex > 0) {
        isHistoryProcessing = true;
        historyIndex--;
        loadHistoryState(history[historyIndex]);
        updateHistoryButtons();
        isHistoryProcessing = false;
    }
}

function redo() {
    if (historyIndex < history.length - 1) {
        isHistoryProcessing = true;
        historyIndex++;
        loadHistoryState(history[historyIndex]);
        updateHistoryButtons();
        isHistoryProcessing = false;
    }
}

function loadHistoryState(jsonString) {
    const data = JSON.parse(jsonString);
    fabricCanvas.getObjects().forEach(obj => { if (!obj.isOverlay) fabricCanvas.remove(obj); });
    
    fabric.util.enlivenObjects(data.objects, (objs) => {
        objs.forEach(obj => { fabricCanvas.add(obj); });
        fabricCanvas.renderAll();
    });
}

function _setupFabricEventHandlers() {
    const colorInput = getEl('markupColor');
    const thicknessInput = getEl('markupThickness');
    const deleteBtn = getEl('deleteMarkupBtn');
    const undoBtn = getEl('undoBtn');
    const redoBtn = getEl('redoBtn');

    let isDragging = false;
    // FIX: Define these variables here to track pan position safely
    let lastPanX = 0;
    let lastPanY = 0;

    fabricCanvas.on('object:added', (e) => { if (!e.target.isOverlay && !isHistoryProcessing) saveHistory(); });
    fabricCanvas.on('object:modified', (e) => { if (!e.target.isOverlay && !isHistoryProcessing) saveHistory(); });
    fabricCanvas.on('object:removed', (e) => { if (!e.target.isOverlay && !isHistoryProcessing) saveHistory(); });

    // --- PINCH ZOOM SUPPORT (iPad) ---
    fabricCanvas.on('touch:gesture', function(e) {
        if (e.e.touches && e.e.touches.length == 2) {
            e.e.preventDefault(); 
            if (e.self.state == "start") {
                fabricCanvas.startZoom = fabricCanvas.getZoom();
            }
            var zoom = fabricCanvas.startZoom * e.self.scale;
            if (zoom > 5) zoom = 5;
            if (zoom < 0.2) zoom = 0.2;
            var point = new fabric.Point(e.self.x, e.self.y);
            fabricCanvas.zoomToPoint(point, zoom);
        }
    });

    // --- MOUSE DOWN ---
    fabricCanvas.on('mouse:down', (o) => {
        const tool = state.markup.tool;
        const pointer = fabricCanvas.getPointer(o.e);

        if (tool === 'pan') {
            isDragging = true;
            fabricCanvas.selection = false;
            fabricCanvas.defaultCursor = 'grabbing';
            fabricCanvas.setCursor('grabbing');

            // FIX: Capture initial Screen Coordinates for Panning
            const e = o.e;
            if(e.touches && e.touches[0]) {
                lastPanX = e.touches[0].clientX;
                lastPanY = e.touches[0].clientY;
            } else {
                lastPanX = e.clientX;
                lastPanY = e.clientY;
            }
        }

        if (tool === 'line') {
            state.markup.line.isDrawing = true;
            const points = [pointer.x, pointer.y, pointer.x, pointer.y];
            state.markup.line.instance = new fabric.Line(points, {
                strokeWidth: parseInt(thicknessInput.value, 10), stroke: colorInput.value, selectable: false, evented: false, strokeLineCap: 'round'
            });
            fabricCanvas.add(state.markup.line.instance);
        } else if (tool === 'text') {
            if (!o.target) {
                const text = new fabric.IText('Your Text', {
                    left: pointer.x, top: pointer.y, fill: colorInput.value, fontSize: parseInt(thicknessInput.value, 10) * 5, 
                });
                fabricCanvas.add(text);
                fabricCanvas.setActiveObject(text);
                text.enterEditing();
                text.selectAll();
                setActiveMarkupTool('select');
            }
        }
    });

    // --- MOUSE MOVE ---
    fabricCanvas.on('mouse:move', (o) => {
        const pointer = fabricCanvas.getPointer(o.e);

        if (isDragging && state.markup.tool === 'pan') {
            const e = o.e;
            let currX, currY;
            
            // Handle Touch vs Mouse
            if(e.touches && e.touches[0]) {
                currX = e.touches[0].clientX;
                currY = e.touches[0].clientY;
            } else {
                currX = e.clientX;
                currY = e.clientY;
            }

            // Calculate Delta
            const deltaX = currX - lastPanX;
            const deltaY = currY - lastPanY;

            // Apply Pan
            const vpt = fabricCanvas.viewportTransform;
            vpt[4] += deltaX;
            vpt[5] += deltaY;
            fabricCanvas.requestRenderAll();
            
            // Update last pos
            lastPanX = currX;
            lastPanY = currY;
        }

        if (state.markup.tool === 'line' && state.markup.line.isDrawing) {
            state.markup.line.instance.set({ x2: pointer.x, y2: pointer.y });
            fabricCanvas.renderAll();
        }
    });

    // --- MOUSE UP ---
    fabricCanvas.on('mouse:up', () => {
        if (isDragging) {
            isDragging = false;
            if (state.markup.tool === 'pan') { 
                fabricCanvas.defaultCursor = 'grab'; 
                fabricCanvas.setCursor('grab'); 
            }
        }
        if (state.markup.line.isDrawing) {
            state.markup.line.instance.set({ evented: true, selectable: true });
            state.markup.line.isDrawing = false;
        }
    });

    fabricCanvas.on('mouse:wheel', function(opt) {
        var delta = opt.e.deltaY;
        var zoom = fabricCanvas.getZoom();
        zoom *= 0.999 ** delta;
        if (zoom > 5) zoom = 5;
        if (zoom < 0.2) zoom = 0.2;
        fabricCanvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
        opt.e.preventDefault();
        opt.e.stopPropagation();
    });

    fabricCanvas.on('selection:created', () => deleteBtn.disabled = false);
    fabricCanvas.on('selection:cleared', () => deleteBtn.disabled = true);
    fabricCanvas.on('selection:updated', () => deleteBtn.disabled = false);

    if(undoBtn) undoBtn.onclick = undo;
    if(redoBtn) redoBtn.onclick = redo;
}

export function renderCustomizerCanvas() {
    return new Promise((resolve) => {
        const floor = db.Floor.find(f => f.id === state.currentFloorId);
        
        const loader = getEl('globalLoader');
        if (loader) loader.classList.remove('hidden');

        if (!fabricCanvas) {
            fabricCanvas = new fabric.Canvas('markupCanvas', { 
                width: 0, 
                height: 0, 
                selection: false, 
                preserveObjectStacking: true,
                defaultCursor: 'grab' 
            });
            _setupFabricEventHandlers();
            saveHistory();
        }

        if (lastFloorId && lastFloorId !== state.currentFloorId) {
            const json = fabricCanvas.toObject(['isOverlay']);
            delete json.backgroundImage;
            const userMarkups = { ...json, objects: json.objects.filter(o => !o.isOverlay) };
            state.floorPlanMarkups[lastFloorId] = userMarkups;
        } else if (state.currentFloorId) {
            const json = fabricCanvas.toObject(['isOverlay']);
            delete json.backgroundImage;
            const userMarkups = { ...json, objects: json.objects.filter(o => !o.isOverlay) };
            state.floorPlanMarkups[state.currentFloorId] = userMarkups;
        }

        if (state.currentFloorId !== lastFloorId) {
            fabricCanvas.clear();
            fabricCanvas.setBackgroundColor(null, fabricCanvas.renderAll.bind(fabricCanvas));
            fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
            lastFloorId = state.currentFloorId;
            history = []; historyIndex = -1; 
        } else {
            fabricCanvas.getObjects().forEach(obj => { if (obj.isOverlay) fabricCanvas.remove(obj); });
        }

        if (!floor) {
            if (loader) loader.classList.add('hidden');
            resolve();
            return;
        }

        let imageUrl = floor.BasePlanImage;
        let isElevationMode = false;

        if (floor.type === 'elevation' || floor.Name.toLowerCase().includes('elevation') || floor.Name.toLowerCase().includes('exterior')) {
            isElevationMode = true;
            const optionSetsForFloor = db.OptionSet.filter(os => os.BelongsToFloor === state.currentFloorId).map(os => os.id);
            const selectedOptionIds = Object.values(state.customizerSelections).flat();
            
            const selectedOption = db.Option.find(opt => 
                optionSetsForFloor.includes(opt.BelongsToOptionSet) && selectedOptionIds.includes(opt.id)
            );

            if (selectedOption && selectedOption.OptionImage) {
                imageUrl = selectedOption.OptionImage;
            } else {
                imageUrl = null; 
            }
        }

        if (!imageUrl) {
            const container = getEl('customizerCanvasContainer').parentElement;
            const canvasWidth = container.offsetWidth;
            const canvasHeight = container.offsetHeight;
            fabricCanvas.setDimensions({ width: canvasWidth, height: canvasHeight });
            fabricCanvas.setBackgroundColor('#ffffff', fabricCanvas.renderAll.bind(fabricCanvas));
            
            if (isElevationMode) {
                const text = new fabric.Text('Select an elevation from the sidebar', {
                    fontSize: 20, fill: '#999', originX: 'center', originY: 'center',
                    left: canvasWidth / 2, top: canvasHeight / 2, selectable: false
                });
                fabricCanvas.add(text);
            }
            
            if (loader) loader.classList.add('hidden');
            resolve();
            return;
        }
        
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => {
            const container = getEl('customizerCanvasContainer').parentElement;
            const canvasWidth = container.offsetWidth;
            const canvasHeight = container.offsetHeight;
            fabricCanvas.setDimensions({ width: canvasWidth, height: canvasHeight });

            const scale = Math.min(canvasWidth / image.width, canvasHeight / image.height);
            const bgImgOffsetX = (canvasWidth - image.width * scale) / 2;
            const bgImgOffsetY = (canvasHeight - image.height * scale) / 2;
            const bgMetrics = { offsetX: bgImgOffsetX, offsetY: bgImgOffsetY, width: image.width * scale, height: image.height * scale };

            fabricCanvas.setBackgroundImage(imageUrl, fabricCanvas.renderAll.bind(fabricCanvas), {
                originX: 'left', originY: 'top', crossOrigin: 'anonymous', scaleX: scale, scaleY: scale, left: bgImgOffsetX, top: bgImgOffsetY,
            });

            const restoreMarkups = new Promise(resolveMarkup => {
                if (state.floorPlanMarkups[state.currentFloorId]) {
                    const savedData = state.floorPlanMarkups[state.currentFloorId];
                    if (savedData.objects) {
                        fabric.util.enlivenObjects(savedData.objects, (objs) => {
                            const currentObjects = fabricCanvas.getObjects().filter(o => !o.isOverlay);
                            if (currentObjects.length === 0) {
                                objs.forEach(obj => fabricCanvas.add(obj));
                            }
                            resolveMarkup();
                        });
                    } else { resolveMarkup(); }
                } else {
                    resolveMarkup();
                }
            });

            restoreMarkups.then(() => {
                if (!isElevationMode) {
                    const optionSetsForFloor = db.OptionSet.filter(os => os.BelongsToFloor === state.currentFloorId).map(os => os.id);
                    const selectedOptionIds = Object.values(state.customizerSelections).flat();
                    
                    const optionPromises = db.Option
                        .filter(opt => optionSetsForFloor.includes(opt.BelongsToOptionSet) && selectedOptionIds.includes(opt.id))
                        .sort((a, b) => (a.layer_order ?? 0) - (b.layer_order ?? 0))
                        .map(option => {
                            return new Promise((r) => {
                                if (!option.OptionImage) return r();
                                fabric.Image.fromURL(option.OptionImage, (img) => {
                                    img.set({
                                        left: bgMetrics.offsetX + (option.X_Position / 100) * bgMetrics.width,
                                        top: bgMetrics.offsetY + (option.Y_Position / 100) * bgMetrics.height,
                                        scaleX: ((option.Width / 100) * bgMetrics.width) / (img.width || 1),
                                        scaleY: ((option.Height / 100) * bgMetrics.height) / (img.height || 1),
                                        selectable: false, evented: false, isOverlay: true
                                    });
                                    fabricCanvas.add(img);
                                    fabricCanvas.sendToBack(img);
                                    r();
                                }, { crossOrigin: 'anonymous' });
                            });
                        });

                    Promise.all(optionPromises).then(() => {
                        saveHistory(); 
                        if (loader) loader.classList.add('hidden');
                        resolve();
                    });
                } else {
                    saveHistory();
                    if (loader) loader.classList.add('hidden');
                    resolve();
                }
            });
        };
        
        image.onerror = () => {
            if (loader) loader.classList.add('hidden');
            resolve();
        };
        image.src = imageUrl;
    });
}

export function handleZoom(factor) {
    if (!fabricCanvas) return;
    const newZoom = fabricCanvas.getZoom() * factor;
    const center = new fabric.Point(fabricCanvas.width / 2, fabricCanvas.height / 2);
    fabricCanvas.zoomToPoint(center, Math.max(0.2, Math.min(5, newZoom)));
}

export function resetZoom() {
    if (!fabricCanvas) return;
    fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
}

// --- NEW FUNCTION: Fit Canvas to Content (Zoom to Extents) ---
function fitContentToCanvas() {
    const objects = fabricCanvas.getObjects();
    if (objects.length === 0 && !fabricCanvas.backgroundImage) return;

    // Use Fabric's internal method to find the bounding box of everything
    let bounds;
    
    // Group all objects (including background if possible) to get bounds
    // Note: backgroundImage in Fabric is not part of getObjects() usually.
    // We must check if background exists.
    
    // 1. Get objects bounds
    if (objects.length > 0) {
        const group = new fabric.Group(objects);
        bounds = { 
            left: group.left, 
            top: group.top, 
            width: group.width, 
            height: group.height 
        };
        // destroy group to not impact canvas
        group.destroy(); 
    }
    
    // 2. Compare with Background Image
    if (fabricCanvas.backgroundImage) {
        const bg = fabricCanvas.backgroundImage;
        // Background coords are typically 0,0 relative to viewport transform [1,0,0,1,0,0]
        // But if zoomed, we need to be careful.
        // We assume we want to capture at least the background image area.
        
        const bgLeft = bg.left || 0;
        const bgTop = bg.top || 0;
        const bgW = bg.width * (bg.scaleX || 1);
        const bgH = bg.height * (bg.scaleY || 1);

        if (!bounds) {
            bounds = { left: bgLeft, top: bgTop, width: bgW, height: bgH };
        } else {
            // Merge bounds
            const minX = Math.min(bounds.left, bgLeft);
            const minY = Math.min(bounds.top, bgTop);
            const maxX = Math.max(bounds.left + bounds.width, bgLeft + bgW);
            const maxY = Math.max(bounds.top + bounds.height, bgTop + bgH);
            bounds = {
                left: minX,
                top: minY,
                width: maxX - minX,
                height: maxY - minY
            };
        }
    }

    if (!bounds) return;

    // 3. Calculate Scale to fit bounds into Canvas Dimensions
    const canvasW = fabricCanvas.width;
    const canvasH = fabricCanvas.height;
    
    const scaleX = canvasW / bounds.width;
    const scaleY = canvasH / bounds.height;
    const scale = Math.min(scaleX, scaleY); // Fit entirely

    // 4. Center logic
    const vpt = [scale, 0, 0, scale, 0, 0];
    // Calculate Pan (Translate) to center the bounds
    const contentCenterX = bounds.left + (bounds.width / 2);
    const contentCenterY = bounds.top + (bounds.height / 2);
    
    vpt[4] = (canvasW / 2) - (contentCenterX * scale);
    vpt[5] = (canvasH / 2) - (contentCenterY * scale);

    fabricCanvas.setViewportTransform(vpt);
    fabricCanvas.renderAll();
}

export function exportPlan() {
    if (!fabricCanvas) return;
    const originalViewport = fabricCanvas.viewportTransform;
    const originalBg = fabricCanvas.backgroundColor;
    
    // FIX: Fit content instead of 1:1 reset
    fitContentToCanvas();
    fabricCanvas.setBackgroundColor('#ffffff', fabricCanvas.renderAll.bind(fabricCanvas));
    
    setTimeout(() => {
        const dataURL = fabricCanvas.toDataURL({ format: 'png', multiplier: 2 });
        const link = createElement('a', { download: 'elevate-floor-plan.png', href: dataURL });
        link.click();
        
        fabricCanvas.setBackgroundColor(originalBg, fabricCanvas.renderAll.bind(fabricCanvas));
        fabricCanvas.setViewportTransform(originalViewport);
    }, 100);
}

export function exportPdf() {
    if (!fabricCanvas) return;
    const { jsPDF } = window.jspdf;
    const pdfBtn = getEl('exportPdfBtn');
    pdfBtn.textContent = 'Generating...';
    pdfBtn.disabled = true;

    const originalViewport = fabricCanvas.viewportTransform;
    const originalBg = fabricCanvas.backgroundColor;
    
    // FIX: Fit content for PDF
    fitContentToCanvas();
    fabricCanvas.setBackgroundColor('#ffffff', fabricCanvas.renderAll.bind(fabricCanvas));

    setTimeout(() => {
        const dataURL = fabricCanvas.toDataURL({ format: 'jpeg', quality: 1.0, multiplier: 2 });
        const pdf = new jsPDF({ orientation: 'l', unit: 'in', format: 'letter' });
        
        const floorName = db.Floor.find(f => f.id === state.currentFloorId)?.Name || 'Floor Plan';
        const modelName = db.ModelHome.find(m => m.id === state.currentModelHomeId)?.Name || 'Model Home';
        const today = new Date().toLocaleDateString();

        const companyText = "Elevate Design + Build";
        const modelSuffix = ` - ${modelName}`;

        pdf.setFontSize(16);
        pdf.setTextColor(236, 141, 68); 
        pdf.text(companyText, 0.5, 0.7);

        const companyWidth = pdf.getTextWidth(companyText);

        pdf.setTextColor(52, 58, 64);
        pdf.text(modelSuffix, 0.5 + companyWidth, 0.7);
        
        pdf.setFontSize(12);
        pdf.setTextColor(0, 0, 0);
        pdf.text(floorName, 0.5, 1.0);
        
        pdf.setFontSize(10);
        pdf.setTextColor(100, 100, 100);
        pdf.text(`Date: ${today}`, 10.5, 0.7, { align: 'right' });

        const pageWidth = 11;
        const pageHeight = 8.5;
        const margin = 0.5;
        const availableWidth = pageWidth - (margin * 2);
        const availableHeight = pageHeight - 2.0; 
        
        const imgProps = pdf.getImageProperties(dataURL);
        const imgRatio = imgProps.width / imgProps.height;
        
        let printWidth = availableWidth;
        let printHeight = availableWidth / imgRatio;
        
        if (printHeight > availableHeight) {
            printHeight = availableHeight;
            printWidth = availableHeight * imgRatio;
        }

        const xOffset = margin + (availableWidth - printWidth) / 2;
        const yOffset = 1.25 + (availableHeight - printHeight) / 2;

        pdf.addImage(dataURL, 'JPEG', xOffset, yOffset, printWidth, printHeight);

        pdf.setFontSize(8);
        pdf.setTextColor(150, 150, 150);
        pdf.text("Note: This is just a selection of structure only, the colors will be finalized after discussion with our designer.", 5.5, 8.2, { align: 'center' });

        pdf.save(`Elevate-Plan-${floorName}.pdf`);
        
        pdfBtn.textContent = 'Export as PDF';
        pdfBtn.disabled = false;
        
        fabricCanvas.setBackgroundColor(originalBg, fabricCanvas.renderAll.bind(fabricCanvas));
        fabricCanvas.setViewportTransform(originalViewport);
    }, 100);
}

export async function generateBrochurePDF(floorIdsToInclude = []) {
    const { jsPDF } = window.jspdf;
    
    const btn = getEl('exportBrochureBtn');
    if (btn) {
        btn.textContent = 'Building Brochure...';
        btn.disabled = true;
    }
    const loader = getEl('globalLoader');
    if(loader) loader.classList.remove('hidden');

    const initialFloorId = state.currentFloorId;
    const initialViewport = fabricCanvas ? fabricCanvas.viewportTransform : null;
    const initialBg = fabricCanvas ? fabricCanvas.backgroundColor : null;
    
    if (fabricCanvas && state.currentFloorId) {
        const json = fabricCanvas.toObject(['isOverlay']);
        delete json.backgroundImage;
        const userMarkups = { ...json, objects: json.objects.filter(o => !o.isOverlay) };
        state.floorPlanMarkups[state.currentFloorId] = userMarkups;
    }

    try {
        const doc = new jsPDF({ orientation: 'p', unit: 'in', format: 'letter' });
        const model = db.ModelHome.find(m => m.id === state.currentModelHomeId);
        const today = new Date().toLocaleDateString();

        // 1. COVER PAGE
        let coverImage = model.CoverImage;
        const elevationFloor = db.Floor.find(f => f.BelongsToModel === state.currentModelHomeId && (f.type === 'elevation' || f.Name.toLowerCase().includes('elevation') || f.Name.toLowerCase().includes('exterior')));
        
        if (elevationFloor) {
            const optionSets = db.OptionSet.filter(os => os.BelongsToFloor === elevationFloor.id).map(os => os.id);
            const selections = Object.values(state.customizerSelections).flat();
            const selectedElev = db.Option.find(o => optionSets.includes(o.BelongsToOptionSet) && selections.includes(o.id));
            if (selectedElev && selectedElev.OptionImage) coverImage = selectedElev.OptionImage;
        }

        doc.setFontSize(24);
        doc.setTextColor(236, 141, 68);
        doc.text("Elevate Design + Build", 4.25, 3, { align: 'center' });
        
        doc.setFontSize(18);
        doc.setTextColor(50, 50, 50);
        doc.text("Custom Home Proposal", 4.25, 3.5, { align: 'center' });
        
        doc.setFontSize(14);
        doc.text(`Model: ${model.Name}`, 4.25, 4, { align: 'center' });
        doc.text(`Date: ${today}`, 4.25, 4.3, { align: 'center' });

        if (coverImage) {
            const imgData = await getBase64FromUrl(coverImage);
            if(imgData) doc.addImage(imgData, 'JPEG', 1, 5, 6.5, 4); 
        }

        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text("Note: This is just a selection of structure only, the colors will be finalized after discussion with our designer.", 4.25, 10.5, { align: 'center' });

        // 2. FLOOR PLANS
        if (floorIdsToInclude.length > 0) {
            doc.addPage();
            doc.setFontSize(16);
            doc.setTextColor(0,0,0);
            doc.text("Floor Plans", 0.5, 1);
            let yPos = 1.5;

            for (const floorId of floorIdsToInclude) {
                const floor = db.Floor.find(f => f.id === parseInt(floorId));
                if (!floor) continue;

                state.currentFloorId = floor.id;
                await renderCustomizerCanvas(); 
                
                // FIX: Fit content for Brochure
                fitContentToCanvas();
                fabricCanvas.setBackgroundColor('#ffffff', fabricCanvas.renderAll.bind(fabricCanvas));
                await new Promise(r => setTimeout(r, 200)); 

                const floorImgData = fabricCanvas.toDataURL({ format: 'jpeg', quality: 1.0, multiplier: 2 });

                if (yPos > 6) { doc.addPage(); yPos = 1; }
                doc.setFontSize(14);
                doc.setTextColor(100,100,100);
                doc.text(floor.Name, 0.5, yPos);
                yPos += 0.3;
                
                if (floorImgData) {
                    const imgProps = doc.getImageProperties(floorImgData);
                    const ratio = imgProps.width / imgProps.height;
                    let printW = 7.5;
                    let printH = 7.5 / ratio;
                    
                    if (printH > 5) { printH = 5; printW = 5 * ratio; }

                    doc.addImage(floorImgData, 'JPEG', 0.5, yPos, printW, printH);
                    yPos += printH + 0.5;
                }
            }
        }

        // 3. DESIGN SELECTIONS
        doc.addPage();
        doc.setFontSize(16);
        doc.setTextColor(0,0,0);
        doc.text("Design & Finish Selections", 0.5, 1);
        let yPos = 1.5;

        // FIX: Removed the filter that excluded elevation. Now ALL selected options show.
        const optionSets = db.OptionSet.sort((a, b) => a.position - b.position);

        for (const set of optionSets) {
            const selIds = state.customizerSelections[set.id];
            if (!selIds || selIds.length === 0) continue;

            // Check if we need a new page
            if (yPos > 9) { doc.addPage(); yPos = 1; }
            
            doc.setFontSize(14);
            doc.setTextColor(236, 141, 68);
            doc.text(set.Name, 0.5, yPos);
            yPos += 0.4;

            const selArray = Array.isArray(selIds) ? selIds : [selIds];
            
            for (const optId of selArray) {
                const opt = db.Option.find(o => o.id === optId);
                if (!opt) continue;

                doc.setFontSize(12);
                doc.setTextColor(0,0,0);
                
                // --- THIS LINE ADDS THE CODE ---
                let optTitle = `Selected Option: ${opt.Name}`;
                if (opt.code) optTitle += ` [${opt.code}]`; 
                doc.text(optTitle, 0.75, yPos);
                yPos += 0.3;

                // Gallery
                const gallerySels = state.designSelections[optId] || [];
                if (gallerySels.length > 0) {
                    let xPos = 0.75;
                    for (const img of gallerySels) {
                        if (yPos > 9) { doc.addPage(); yPos = 1; }
                        try {
                            const base64 = await getBase64FromUrl(img.url);
                            if (base64) {
                                doc.addImage(base64, 'JPEG', xPos, yPos, 2, 1.5);
                                doc.setFontSize(9);
                                doc.setTextColor(100,100,100);
                                let label = img.group || '';
                                if(img.description) label += ` - ${img.description}`;
                                if(label) doc.text(label, xPos, yPos + 1.7);
                            }
                        } catch(e) {}
                        xPos += 2.2;
                        if (xPos > 7) { xPos = 0.75; yPos += 2.0; }
                    }
                    if (gallerySels.length > 0) yPos += 2.0; 
                }

                // Uploads
                const uploads = state.userUploads[optId] || [];
                if (uploads.length > 0) {
                    doc.setFontSize(11);
                    doc.text("Your References:", 0.75, yPos);
                    yPos += 0.2;
                    let xPos = 0.75;
                    for (const up of uploads) {
                        try {
                            const base64 = await getBlobAsBase64(up.url);
                            if(base64) doc.addImage(base64, 'JPEG', xPos, yPos, 2, 1.5);
                        } catch(e){}
                        xPos += 2.2;
                    }
                    yPos += 1.8;
                }

                // Notes
                const note = state.galleryNotes[optId];
                if (note) {
                    if (yPos > 9) { doc.addPage(); yPos = 1; }
                    doc.setFontSize(10);
                    doc.setTextColor(50,50,50);
                    doc.setFont(undefined, 'italic');
                    const splitNotes = doc.splitTextToSize(`Note: ${note}`, 7);
                    doc.text(splitNotes, 0.75, yPos);
                    doc.setFont(undefined, 'normal');
                    yPos += (splitNotes.length * 0.2) + 0.2;
                }
                yPos += 0.2;
            }
            yPos += 0.2;
        }

        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text("Note: This is just a selection of structure only, the colors will be finalized after discussion with our designer.", 4.25, 10.5, { align: 'center' });

        doc.save(`${model.Name}-Brochure.pdf`);

    } catch (err) {
        console.error("Brochure Generation Error:", err);
        alert("Failed to generate brochure. Check console.");
    } finally {
        if (state.currentFloorId !== initialFloorId) {
            state.currentFloorId = initialFloorId;
            await renderCustomizerCanvas();
        }
        
        if (initialViewport && fabricCanvas) {
            fabricCanvas.setViewportTransform(initialViewport);
            if (initialBg) fabricCanvas.setBackgroundColor(initialBg, fabricCanvas.renderAll.bind(fabricCanvas));
        }

        if (btn) {
            btn.textContent = 'Generate Design Brochure';
            btn.disabled = false;
        }
        if(loader) loader.classList.add('hidden');
    }
}

async function getBase64FromUrl(url) {
    try {
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) throw new Error('Fetch failed');
        const blob = await res.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        return null;
    }
}

async function getBlobAsBase64(blobUrl) {
    const res = await fetch(blobUrl);
    const blob = await res.blob();
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
}

export function setupMarkupBarListeners() {
    const markupBar = getEl('markup-bar');
    const colorInput = getEl('markupColor');
    const thicknessInput = getEl('markupThickness');
    const deleteBtn = getEl('deleteMarkupBtn');
    deleteBtn.disabled = true;

    markupBar.addEventListener('click', (e) => {
        const button = e.target.closest('button[data-tool]');
        if (button) setActiveMarkupTool(button.dataset.tool);
    });

    const updateObjectProperty = (prop, value) => {
        const activeObject = fabricCanvas.getActiveObject();
        if (activeObject) {
            if (activeObject.type === 'i-text' && (prop === 'stroke' || prop === 'strokeWidth')) {
                 activeObject.set('fill', colorInput.value);
                 if(prop === 'strokeWidth') activeObject.set('fontSize', parseInt(value, 10) * 5);
            } else {
                 activeObject.set(prop, value);
            }
            fabricCanvas.renderAll();
        }
    };

    colorInput.addEventListener('input', () => {
        const color = colorInput.value;
        if(fabricCanvas.isDrawingMode) fabricCanvas.freeDrawingBrush.color = color;
        updateObjectProperty('stroke', color);
    });

    thicknessInput.addEventListener('input', () => {
        const thickness = parseInt(thicknessInput.value, 10);
        if(fabricCanvas.isDrawingMode) fabricCanvas.freeDrawingBrush.width = thickness;
        updateObjectProperty('strokeWidth', thickness);
    });

    deleteBtn.addEventListener('click', () => {
        const activeObjects = fabricCanvas.getActiveObjects();
        if (activeObjects) activeObjects.forEach(obj => fabricCanvas.remove(obj));
        fabricCanvas.discardActiveObject().renderAll();
    });

    window.addEventListener('keydown', (e) => {
        const activeEl = document.activeElement.tagName;
        if (activeEl === 'INPUT' || activeEl === 'TEXTAREA') return;

        if ((e.key === 'Delete' || e.key === 'Backspace') && fabricCanvas.getActiveObject()) {
            const activeObjects = fabricCanvas.getActiveObjects();
            if (activeObjects.length > 0) {
                 activeObjects.forEach(obj => fabricCanvas.remove(obj));
                 fabricCanvas.discardActiveObject().renderAll();
            }
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); }
    });
}

function setActiveMarkupTool(tool) {
    if (!fabricCanvas) return;
    state.markup.tool = tool;
    fabricCanvas.isDrawingMode = (tool === 'freeform');
    if (tool === 'freeform') {
        fabricCanvas.freeDrawingBrush.color = getEl('markupColor').value;
        fabricCanvas.freeDrawingBrush.width = parseInt(getEl('markupThickness').value, 10);
        fabricCanvas.defaultCursor = 'crosshair';
    } else if (tool === 'select') {
        fabricCanvas.defaultCursor = 'default';
        fabricCanvas.selection = true;
    } else if (tool === 'pan') {
        fabricCanvas.defaultCursor = 'grab';
        fabricCanvas.selection = false;
    } else {
        fabricCanvas.defaultCursor = 'crosshair';
        fabricCanvas.selection = false;
    }
    document.querySelectorAll('#markup-bar button[data-tool]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tool === tool);
    });
}