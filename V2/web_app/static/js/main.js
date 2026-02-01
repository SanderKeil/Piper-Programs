// Global state
let latestPose = null;
let poseList = []; // Nested structure: { type: 'pose'|'gripper'|'folder', children: [], ... }
let isPlaying = false;
let dragSrcPath = null; // Track path of dragged item: [index, subindex, ...]
let clipboard = null;   // For cut/copy/paste (Array of items)
let selectionSet = new Set(); // Set of JSON path strings
let undoStack = [];
let redoStack = [];

// --- Undo/Redo ---

function saveState() {
    // Deep clone poseList
    const state = JSON.parse(JSON.stringify(poseList));
    undoStack.push(state);
    if (undoStack.length > 50) undoStack.shift(); // Limit history
    redoStack = []; // Clear redo on new action
}

function undo() {
    if (undoStack.length === 0) return;
    const currentState = JSON.parse(JSON.stringify(poseList));
    redoStack.push(currentState);

    poseList = undoStack.pop();
    selectionSet.clear(); // Clear selection to avoid invalid paths
    renderPoseList();
    console.log("Undo performed");
}

function redo() {
    if (redoStack.length === 0) return;
    const currentState = JSON.parse(JSON.stringify(poseList));
    undoStack.push(currentState);

    poseList = redoStack.pop();
    selectionSet.clear();
    renderPoseList();
    console.log("Redo performed");
}

// --- Tab Logic ---
function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.tab === tabId) btn.classList.add('active');
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
        if (content.id === tabId) content.classList.add('active');
    });
}

// --- Status Polling ---
async function pollState() {
    try {
        const response = await fetch('/api/current_state');
        const result = await response.json();
        if (result.success) {
            const j = result.joints;
            const p = result.end_pose;
            const g = result.gripper || 0;

            latestPose = p;

            // UI Update
            const setVal = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.value = val.toFixed(3);
            };

            setVal('fb_j1', j.j1);
            setVal('fb_j2', j.j2);
            setVal('fb_j3', j.j3);
            setVal('fb_j4', j.j4);
            setVal('fb_j5', j.j5);
            setVal('fb_j6', j.j6);

            // Update 3D
            if (window.Piper3D) {
                window.Piper3D.update([j.j1, j.j2, j.j3, j.j4, j.j5, j.j6], g);
            }

            // Status Badge Update
            if (result.meta) {
                const badge = document.getElementById('robot-status-badge');
                if (badge) {
                    const mode = result.meta.ctrl_mode;
                    if (mode === 1) {
                        badge.textContent = 'CAN Control';
                        badge.className = 'status-badge status-can';
                    } else if (mode === 2) {
                        badge.textContent = 'Teaching';
                        badge.className = 'status-badge status-teach';
                    } else if (mode === 0) {
                        badge.textContent = 'Standby';
                        badge.className = 'status-badge status-standby';
                    } else {
                        badge.textContent = 'Status: ' + mode;
                        badge.className = 'status-badge status-offline';
                    }
                }
            }
        }
    } catch (e) {
        console.error("Fetch error", e);
    }
    setTimeout(pollState, 100);
}

// --- Control Functions ---

function updateEffortDisplay() {
    const val = document.getElementById('gripper-effort').value;
    document.getElementById('effort-val').textContent = (val / 1000).toFixed(1) + ' N';
}

async function moveGripper(val, effortInput = null) {
    const statusEl = document.getElementById('status');
    statusEl.textContent = 'Sending gripper command...';

    const elSlider = document.getElementById('gripper');
    const elLabel = document.getElementById('gripper-val');

    if (elSlider && elSlider.value != val) elSlider.value = val;
    if (elLabel) elLabel.textContent = val;

    const effort = effortInput !== null ? effortInput : parseInt(document.getElementById('gripper-effort').value);

    try {
        const response = await fetch('/api/move_gripper', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gripper: parseInt(val), effort: effort })
        });
        const result = await response.json();
        if (result.success) {
            statusEl.textContent = 'Gripper moved';
            statusEl.className = 'success';
        } else {
            statusEl.textContent = 'Error: ' + result.message;
            statusEl.className = 'error';
        }
    } catch (err) {
        console.error(err);
    }
}

function setGripper(val) {
    moveGripper(val);
}

function moveGripperFromSlider() {
    const val = document.getElementById('gripper').value;
    document.getElementById('gripper-val').textContent = val;
    moveGripper(val);
}

async function getCurrentPose() {
    try {
        const response = await fetch('/api/current_state');
        const result = await response.json();
        if (result.success) {
            const p = result.end_pose;
            document.getElementById('ep_x').value = p.x.toFixed(2);
            document.getElementById('ep_y').value = p.y.toFixed(2);
            document.getElementById('ep_z').value = p.z.toFixed(2);
            document.getElementById('ep_rx').value = p.rx.toFixed(2);
            document.getElementById('ep_ry').value = p.ry.toFixed(2);
            document.getElementById('ep_rz').value = p.rz.toFixed(2);

            const j = result.joints;
            document.getElementById('j1').value = j.j1.toFixed(2);
            document.getElementById('j2').value = j.j2.toFixed(2);
            document.getElementById('j3').value = j.j3.toFixed(2);
            document.getElementById('j4').value = j.j4.toFixed(2);
            document.getElementById('j5').value = j.j5.toFixed(2);
            document.getElementById('j6').value = j.j6.toFixed(2);
        }
    } catch (e) {
        console.error(e);
    }
}

async function enableCANControl() {
    const statusEl = document.getElementById('status');
    statusEl.textContent = 'Enabling CAN Control...';
    try {
        const response = await fetch('/api/enable_can', { method: 'POST' });
        const result = await response.json();
        if (result.success) {
            statusEl.textContent = 'Switched to CAN Control';
            statusEl.className = 'success';
        } else {
            statusEl.textContent = 'Error: ' + result.message;
            statusEl.className = 'error';
        }
    } catch (err) {
        console.error(err);
        statusEl.textContent = 'Network Error';
        statusEl.className = 'error';
    }
}

async function moveEndPose() {
    const statusEl = document.getElementById('status');
    statusEl.textContent = 'Sending pose command...';
    statusEl.className = '';

    const data = {
        x: parseFloat(document.getElementById('ep_x').value),
        y: parseFloat(document.getElementById('ep_y').value),
        z: parseFloat(document.getElementById('ep_z').value),
        rx: parseFloat(document.getElementById('ep_rx').value),
        ry: parseFloat(document.getElementById('ep_ry').value),
        rz: parseFloat(document.getElementById('ep_rz').value)
    };

    try {
        const response = await fetch('/api/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (result.success) {
            statusEl.textContent = 'Pose command sent';
            statusEl.className = 'success';
        } else {
            statusEl.textContent = 'Error: ' + result.message;
            statusEl.className = 'error';
        }
    } catch (err) {
        statusEl.textContent = 'Network Error: ' + err.message;
        statusEl.className = 'error';
    }
}

async function moveJoints() {
    const statusEl = document.getElementById('status');
    statusEl.textContent = 'Sending command...';
    statusEl.className = '';

    const data = {
        j1: parseFloat(document.getElementById('j1').value),
        j2: parseFloat(document.getElementById('j2').value),
        j3: parseFloat(document.getElementById('j3').value),
        j4: parseFloat(document.getElementById('j4').value),
        j5: parseFloat(document.getElementById('j5').value),
        j6: parseFloat(document.getElementById('j6').value)
    };

    try {
        const response = await fetch('/api/move_joints', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.success) {
            statusEl.textContent = 'Command sent successfully';
            statusEl.className = 'success';
        } else {
            statusEl.textContent = 'Error: ' + result.message;
            statusEl.className = 'error';
        }
    } catch (err) {
        statusEl.textContent = 'Network Error: ' + err.message;
        statusEl.className = 'error';
    }
}

async function moveToPose(pose) {
    const statusEl = document.getElementById('status');
    statusEl.textContent = `Moving to ${pose.name}...`;

    const data = {
        j1: pose.joints[0],
        j2: pose.joints[1],
        j3: pose.joints[2],
        j4: pose.joints[3],
        j5: pose.joints[4],
        j6: pose.joints[5],
        speed: pose.speed || 50,
        move_mode: pose.move_mode || 0x01,
        end_pose: pose.end_pose
    };

    try {
        const response = await fetch('/api/move_joints', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (result.success) {
            statusEl.textContent = `Reached ${pose.name}`;
            statusEl.className = 'success';
        } else {
            statusEl.textContent = 'Error: ' + result.message;
            statusEl.className = 'error';
        }
    } catch (err) {
        console.error(err);
    }
}

// --- Sequencer Logic (Revised for Features) ---

// Helper to find node by path
function getNodeByPath(path) {
    let list = poseList;
    for (let i = 0; i < path.length - 1; i++) {
        list = list[path[i]].children;
    }
    return list[path[path.length - 1]];
}

// Helper to remove node by path
function removeNodeByPath(path) {
    let list = poseList;
    for (let i = 0; i < path.length - 1; i++) {
        list = list[path[i]].children;
    }
    const removed = list.splice(path[path.length - 1], 1)[0];
    return removed;
}

// Helper to insert node at path
function insertNodeAtPath(path, node) {
    let list = poseList;
    for (let i = 0; i < path.length - 1; i++) {
        list = list[path[i]].children;
    }
    list.splice(path[path.length - 1], 0, node);
}

// Append to folder at path
function appendToFolder(path, node) {
    const folder = getNodeByPath(path);
    if (folder.type === 'folder') {
        if (!folder.children) folder.children = [];
        folder.children.push(node);
    }
}

// --- CRUD Operations ---

function addFolder() {
    const folder = {
        type: 'folder',
        name: 'New Folder',
        children: [],
        collapsed: false
    };

    // Add to key selected folder/item
    // Logic similar to addToCurrentContext
    saveState();
    if (selectionSet.size > 0) {
        const paths = Array.from(selectionSet).map(s => JSON.parse(s)).sort((a, b) => {
            for (let i = 0; i < Math.min(a.length, b.length); i++) {
                if (a[i] !== b[i]) return a[i] - b[i];
            }
            return a.length - b.length;
        });
        const lastMethod = paths[paths.length - 1]; // Use last selected

        const selected = getNodeByPath(lastMethod);
        if (selected.type === 'folder') {
            selected.children.push(folder);
            selected.collapsed = false;
        } else {
            // Insert after selected
            const parentPath = lastMethod.slice(0, -1);
            const idx = lastMethod[lastMethod.length - 1];
            insertNodeAtPath([...parentPath, idx + 1], folder);
        }
    } else {
        poseList.push(folder);
    }
    renderPoseList();
}

function capturePose() {
    const j1 = parseFloat(document.getElementById('fb_j1').value) || 0;
    const j2 = parseFloat(document.getElementById('fb_j2').value) || 0;
    const j3 = parseFloat(document.getElementById('fb_j3').value) || 0;
    const j4 = parseFloat(document.getElementById('fb_j4').value) || 0;
    const j5 = parseFloat(document.getElementById('fb_j5').value) || 0;
    const j6 = parseFloat(document.getElementById('fb_j6').value) || 0;
    const gripper = parseInt(document.getElementById('gripper').value) || 0;
    // const effort = parseInt(document.getElementById('gripper-effort').value) || 1000;

    const pose = {
        type: 'pose',
        name: `Pose`,
        joints: [j1, j2, j3, j4, j5, j6],
        end_pose: latestPose ? [latestPose.x, latestPose.y, latestPose.z, latestPose.rx, latestPose.ry, latestPose.rz] : [0, 0, 0, 0, 0, 0],
        speed: 50,
        duration: 2000,
        move_mode: 0x01
    };

    addToCurrentContext(pose);
}

function addGripperAction(val) {
    const effort = parseInt(document.getElementById('gripper-effort').value) || 1000;
    const action = {
        type: 'gripper',
        name: val > 50 ? 'Gripper Open' : 'Gripper Close',
        value: val,
        effort: effort,
        speed: 100,
        duration: 500
    };
    addToCurrentContext(action);
}

function addToCurrentContext(item) {
    saveState();
    if (selectionSet.size > 0) {
        // Find the "last" selected item to append after/inside
        // Sort normal order to find last item
        const paths = Array.from(selectionSet).map(s => JSON.parse(s)).sort((a, b) => {
            for (let i = 0; i < Math.min(a.length, b.length); i++) {
                if (a[i] !== b[i]) return a[i] - b[i];
            }
            return a.length - b.length;
        });
        const lastMethod = paths[paths.length - 1]; // Use last selected

        const selected = getNodeByPath(lastMethod);
        if (selected.type === 'folder') {
            if (!selected.children) selected.children = [];
            selected.children.push(item);
            selected.collapsed = false;
        } else {
            // Insert after
            const parentPath = lastMethod.slice(0, -1);
            const idx = lastMethod[lastMethod.length - 1];
            insertNodeAtPath([...parentPath, idx + 1], item);
        }
    } else {
        poseList.push(item);
    }
    renderPoseList();
}

// --- Clipboard ---

// --- Clipboard ---

function selectItem(path, event = null) {
    const pathStr = JSON.stringify(path);

    // Multi-select logic
    if (event && (event.ctrlKey || event.metaKey)) {
        if (selectionSet.has(pathStr)) {
            selectionSet.delete(pathStr);
        } else {
            selectionSet.add(pathStr);
        }
    } else {
        // Single select (clear others)
        selectionSet.clear();
        selectionSet.add(pathStr);
    }
    updateSelectionStyles();
}

function updateSelectionStyles() {
    document.querySelectorAll('.pose-item').forEach(li => {
        // Reset border logic (keeping folder structure in mind)
        // If it's a folder-header, we still might target its border.
        li.style.border = "1px solid #444";

        // If selected
        if (li.dataset.path && selectionSet.has(li.dataset.path)) {
            li.style.border = "2px solid var(--secondary-color)";
        }
    });
}

// Helper to get selected paths sorted for safe deletion (reverse order)
function getSortedSelection() {
    return Array.from(selectionSet).map(s => JSON.parse(s)).sort((a, b) => {
        // Sort by length first (deeper first), then index descending
        if (a.length !== b.length) return b.length - a.length;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return b[i] - a[i]; // Descending
        }
        return 0;
    });
}

function cutSelection() {
    if (selectionSet.size === 0) return;
    saveState();
    try {
        const paths = getSortedSelection();
        clipboard = [];
        paths.forEach(p => {
            clipboard.push(removeNodeByPath(p));
        });
        // Selection is now invalid, clear it
        selectionSet.clear();
        renderPoseList();
        console.log("Cut items to clipboard:", clipboard);
    } catch (e) { console.error("Cut failed", e); }
}

function copySelection() {
    if (selectionSet.size === 0) return;
    try {
        const paths = getSortedSelection();
        clipboard = [];
        // Note: For copy, order doesn't matter as much for safety, but consistent order is good.
        // However, we want them in layout order?
        // getSortedSelection gives reverse order.
        // Let's reverse back to normal order for clipboard so paste is intuitive.
        paths.reverse(); // Now normal order (top-down)
        paths.forEach(p => {
            clipboard.push(JSON.parse(JSON.stringify(getNodeByPath(p))));
        });
        console.log("Copied items to clipboard:", clipboard);
    } catch (e) { console.error("Copy failed", e); }
}

function pasteSelection() {
    if (!clipboard || clipboard.length === 0) return;
    saveState();

    // Paste after the last selected item, or at end.
    // If multiple selected, pick the last one in DOM order as insertion point.
    // Actually, just pick the last one added to set? Or finding the 'last' path.

    let targetPath = null;
    if (selectionSet.size > 0) {
        // Find "last" path in normal order
        const paths = Array.from(selectionSet).map(s => JSON.parse(s)).sort((a, b) => {
            // Normal order sort
            for (let i = 0; i < Math.min(a.length, b.length); i++) {
                if (a[i] !== b[i]) return a[i] - b[i];
            }
            return a.length - b.length;
        });
        targetPath = paths[paths.length - 1];
    }

    if (targetPath) {
        const target = getNodeByPath(targetPath);
        if (target.type === 'folder') {
            if (!target.children) target.children = [];
            clipboard.forEach(item => {
                const newItem = JSON.parse(JSON.stringify(item));
                target.children.push(newItem);
            });
        } else {
            // Insert after target
            const parentPath = targetPath.slice(0, -1);
            const idx = targetPath[targetPath.length - 1];
            clipboard.forEach((item, i) => {
                const newItem = JSON.parse(JSON.stringify(item));
                insertNodeAtPath([...parentPath, idx + 1 + i], newItem);
            });
        }
    } else {
        // Append to root
        clipboard.forEach(item => {
            const newItem = JSON.parse(JSON.stringify(item));
            poseList.push(newItem);
        });
    }
    renderPoseList();
}

// --- Rendering ---

function renderPoseList() {
    const list = document.getElementById('pose-list');
    list.innerHTML = '';
    renderRecursive(poseList, list, []);
}

function renderRecursive(items, container, pathPrefix) {
    items.forEach((item, index) => {
        const currentPath = [...pathPrefix, index];
        const pathStr = JSON.stringify(currentPath);
        const isSelected = selectionSet.has(pathStr);

        const li = document.createElement('li');
        li.className = 'pose-item';
        if (item.type === 'folder') {
            li.classList.add('folder-header');
            if (item.collapsed) li.classList.add('collapsed');
        }
        if (isSelected) {
            li.style.border = "2px solid var(--secondary-color)";
        }

        li.draggable = true;
        li.dataset.path = pathStr;

        // Drag Events
        li.addEventListener('dragstart', handleDragStart);
        li.addEventListener('dragover', handleDragOver);
        li.addEventListener('drop', handleDrop);
        li.addEventListener('dragenter', handleDragEnter);
        li.addEventListener('dragleave', handleDragLeave);
        li.onclick = (e) => {
            e.stopPropagation();
            selectItem(currentPath, e);
        };

        // Folder Toggle
        if (item.type === 'folder') {
            const toggle = document.createElement('span');
            toggle.className = 'folder-toggle';
            toggle.textContent = item.collapsed ? '▶' : '▼';
            toggle.onclick = (e) => {
                e.stopPropagation();
                item.collapsed = !item.collapsed;
                renderPoseList();
            };
            li.appendChild(toggle);
        }

        // Name
        const inputName = document.createElement('input');
        inputName.type = 'text';
        inputName.className = 'pose-name';
        inputName.value = item.name;
        inputName.onfocus = function () {
            // Saving state on focus *might* be too aggressive or correct depending on preference.
            // Usually on change is better. But for text, we want to save *before* the change?
            // Actually, saveState saves current state. So if we call it at start of onchange, we save OLD state.
            // YES.
            selectItem(currentPath);
            // ... selection logic ...
            const isGeneric = this.value === 'Pose' ||
                this.value === 'New Folder' ||
                this.value.match(/^Pose \d+$/);

            if (isGeneric) {
                this.select();
            } else {
                const len = this.value.length;
                this.setSelectionRange(len, len);
            }
        };
        // We need to capture state BEFORE change. 
        // onchange fires after change is committed (blur or enter).
        // But the item object is mutated inside the handler.
        // So: saveState(); item.name = ...
        inputName.onchange = (e) => {
            saveState();
            item.name = e.target.value;
        };

        // ... (draggable logic) ...
        inputName.setAttribute('draggable', 'false');
        inputName.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });
        inputName.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        inputName.ondragstart = (e) => {
            e.preventDefault();
            e.stopPropagation();
        };
        li.appendChild(inputName);

        const addLbl = (txt) => {
            const s = document.createElement('span');
            s.textContent = txt;
            s.style.fontSize = '12px';
            s.style.color = '#888';
            s.style.marginLeft = '5px';
            s.style.marginRight = '2px';
            li.appendChild(s);
        };

        if (item.type === 'pose') {
            // Speed
            const inputSpeed = document.createElement('input');
            inputSpeed.type = 'number';
            inputSpeed.className = 'pose-name';
            inputSpeed.value = item.speed;
            inputSpeed.placeholder = 'Spd';
            inputSpeed.title = 'Speed (0-100)';
            inputSpeed.style.width = '40px';
            inputSpeed.style.flexGrow = '0';
            inputSpeed.onchange = (e) => {
                saveState();
                item.speed = parseInt(e.target.value);
            };

            addLbl('Spd:');
            li.appendChild(inputSpeed);

            // Linear Check
            const lblLin = document.createElement('label');
            lblLin.style.fontSize = '12px';
            lblLin.style.display = 'flex';
            lblLin.style.alignItems = 'center';
            const chkLin = document.createElement('input');
            chkLin.type = 'checkbox';
            chkLin.checked = item.move_mode === 0x02;
            chkLin.onchange = (e) => {
                saveState();
                item.move_mode = e.target.checked ? 0x02 : 0x01;
            };
            lblLin.appendChild(chkLin);
            lblLin.appendChild(document.createTextNode('Linear'));
            li.appendChild(lblLin);

            // Coordinates Display (Subtle)
            const span = document.createElement('span');
            // Show only End Pose (X,Y,Z,RX,RY,RZ)
            const pStr = item.end_pose ? ` [${item.end_pose.map(v => Math.round(v)).join(',')}]` : '';
            span.textContent = pStr;
            span.className = 'pose-conf';
            span.style.fontSize = '0.7em';
            span.style.opacity = '0.6';
            span.style.marginLeft = '10px';
            span.style.whiteSpace = 'nowrap';
            span.style.overflow = 'hidden';
            span.style.textOverflow = 'ellipsis';
            span.style.maxWidth = '250px'; // Slightly wider for 6 values
            li.appendChild(span);
        }

        if (item.type !== 'folder') {
            // Wait/Dur
            const inputDur = document.createElement('input');
            inputDur.type = 'number';
            inputDur.className = 'pose-name';
            inputDur.value = item.duration;
            inputDur.placeholder = 'ms';
            inputDur.title = 'Wait Duration (ms)';
            inputDur.style.width = '50px';
            inputDur.style.flexGrow = '0';
            inputDur.onchange = (e) => {
                saveState();
                item.duration = parseInt(e.target.value);
            };

            addLbl(item.type === 'pose' ? 'Wait:' : 'Dur:');
            li.appendChild(inputDur);
        }

        // Play Button (Single)
        const btnPlay = document.createElement('button');
        btnPlay.className = 'btn-sm secondary';
        btnPlay.textContent = '▶';
        btnPlay.onclick = (e) => {
            e.stopPropagation();
            if (item.type === 'gripper') moveGripper(item.value, item.effort || 1000);
            else if (item.type === 'pose') moveToPose(item);
            else if (item.type === 'folder') playRecursive([item]); // Play folder
        };
        li.appendChild(btnPlay);

        // Delete Button
        const btnDel = document.createElement('button');
        btnDel.className = 'btn-sm error-btn';
        btnDel.textContent = '✕';
        btnDel.onclick = (e) => {
            e.stopPropagation();
            saveState();
            removeNodeByPath(currentPath);
            selectionSet.clear();
            renderPoseList();
        };
        li.appendChild(btnDel);

        container.appendChild(li);

        // Children (for folders)
        if (item.type === 'folder' && !item.collapsed) {
            const ul = document.createElement('ul');
            ul.className = 'folder-children';
            renderRecursive(item.children || [], ul, currentPath);
            container.appendChild(ul);
        }
    });
}

// --- Recursive Execution ---

async function playSequence() {
    if (isPlaying) return;
    isPlaying = true;
    const statusEl = document.getElementById('status');
    statusEl.textContent = 'Starting sequence...';

    // Deep flatten for execution
    const flatList = flattenSequence(poseList);

    for (let i = 0; i < flatList.length; i++) {
        if (!isPlaying) break;
        const item = flatList[i];

        // Highlight active item? (Requires knowing path, skipping for now)

        if (item.type === 'gripper') {
            await moveGripper(item.value, item.effort || 1000);
        } else if (item.type === 'pose') {
            await moveToPose(item);
        }

        const waitTime = item.duration || 1000;
        await new Promise(r => setTimeout(r, waitTime));
    }
    isPlaying = false;
    statusEl.textContent = 'Sequence finished';
}

async function playRecursive(list) {
    // Mini-player for folders
    const flatList = flattenSequence(list);
    for (const item of flatList) {
        if (!isPlaying && document.getElementById('status').textContent !== 'Ready') {
            // If main stop wasn't triggered but we want to be safe
        }
        if (item.type === 'gripper') await moveGripper(item.value, item.effort || 1000);
        else if (item.type === 'pose') await moveToPose(item);
        await new Promise(r => setTimeout(r, item.duration || 1000));
    }
}

function flattenSequence(list) {
    let result = [];
    list.forEach(item => {
        if (item.type === 'folder') {
            result = result.concat(flattenSequence(item.children || []));
        } else {
            result.push(item);
        }
    });
    return result;
}

function stopSequence() {
    isPlaying = false;
    document.getElementById('status').textContent = 'Sequence stopped';
}

function saveSequence() {
    if (poseList.length === 0) {
        alert("Sequence is empty!");
        return;
    }
    const blob = new Blob([JSON.stringify(poseList, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'piper_sequence.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function loadSequence(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = JSON.parse(e.target.result);
            if (Array.isArray(data)) {
                poseList = data;
                // Validate/Fix structure if legacy
                poseList.forEach(item => {
                    if (!item.type) {
                        item.type = item.joints ? 'pose' : 'gripper'; // Simple heuristic
                    }
                });
                renderPoseList();
                document.getElementById('status').textContent = 'Sequence loaded successfully';
                document.getElementById('status').className = 'success';
            } else {
                throw new Error("Invalid file format: Not an array");
            }
        } catch (err) {
            alert("Failed to load sequence: " + err.message);
        }
    };
    reader.readAsText(file);
    input.value = '';
}


// --- Drag & Drop (Updated for Tree) ---

function handleDragStart(e) {
    e.stopPropagation();
    dragSrcPath = JSON.parse(this.dataset.path);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify(dragSrcPath));
    this.classList.add('dragging');
}

function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';

    // Visual feedback
    const rect = this.getBoundingClientRect();
    const relY = e.clientY - rect.top;

    this.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-folder');

    // If dragging over a folder, allow "insert inside" zone in middle
    // If generic item, only top/bottom

    // Check if target is folder
    // We need to look up item to know type? Or check class?
    const isFolder = this.classList.contains('folder-header');

    if (isFolder) {
        if (relY < rect.height * 0.25) this.classList.add('drag-over-top');
        else if (relY > rect.height * 0.75) this.classList.add('drag-over-bottom');
        else this.classList.add('drag-over-folder');
    } else {
        if (relY < rect.height * 0.5) this.classList.add('drag-over-top');
        else this.classList.add('drag-over-bottom');
    }

    return false;
}

function handleDragEnter(e) {
    e.preventDefault();
    e.stopPropagation();
}

function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    this.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-folder');
}

function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    this.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-folder');

    const destPath = JSON.parse(this.dataset.path);
    if (!dragSrcPath || JSON.stringify(dragSrcPath) === JSON.stringify(destPath)) return;

    // Calculate position relative to target
    const rect = this.getBoundingClientRect();
    const relY = e.clientY - rect.top;

    let position = 'after';
    const isFolder = this.classList.contains('folder-header');

    if (isFolder && relY >= rect.height * 0.25 && relY <= rect.height * 0.75) {
        position = 'inside';
    } else if (relY < rect.height * 0.5) {
        position = 'before';
    }

    // Perform Move
    saveState();
    // 1. Remove Source
    const srcItem = removeNodeByPath(dragSrcPath);

    // 2. Adjust Dest Path if needed (if src was removed from same list before dest)
    // Actually, paths might be invalidated if we mutate tree.
    // Re-fetching dest path is tricky if it shifted.
    // However, removeNodeByPath mutates 'poseList'.
    // If src and dest share a parent, and src index < dest index, dest index decrements.

    // Let's implement robust re-calculation? 
    // Or cheat: re-read lists?
    // Since paths are arrays of indices, this is sensitive.

    // Simplification: Refresh references isn't easy.
    // Let's rely on the fact we have the arrays.

    // CORRECT APPROACH:
    // If src is "higher up" in the same list as dest, dest index--.
    // Check prefix equality.

    // But wait, we already removed it.
    // If we removed it, we need to know where to put it.
    // BUT 'destPath' was generated BEFORE removal.

    // Fix:
    let adjustedDestPath = [...destPath];

    // Check if same parent list
    const srcParent = dragSrcPath.slice(0, -1);
    const destParent = destPath.slice(0, -1);

    if (JSON.stringify(srcParent) === JSON.stringify(destParent)) {
        const srcIdx = dragSrcPath[dragSrcPath.length - 1];
        const destIdx = destPath[destPath.length - 1];

        if (srcIdx < destIdx) {
            adjustedDestPath[adjustedDestPath.length - 1]--;
        }
    }

    if (position === 'inside') {
        const folder = getNodeByPath(adjustedDestPath);
        if (!folder.children) folder.children = [];
        folder.children.push(srcItem);
        folder.collapsed = false; // Auto expand
    } else {
        const parentPath = adjustedDestPath.slice(0, -1);
        const idx = adjustedDestPath[adjustedDestPath.length - 1];
        const insertIdx = position === 'before' ? idx : idx + 1;
        insertNodeAtPath([...parentPath, insertIdx], srcItem);
    }

    renderPoseList();
    dragSrcPath = null;
    return false;
}


// --- Initialization ---
window.onload = function () {
    console.log("Window loaded. Checking for Piper3D...");
    if (window.Piper3D) {
        console.log("Piper3D found. Initializing...");
        window.Piper3D.init();
    } else {
        console.error("Piper3D not found!");
    }
    pollState();
    getCurrentPose();

    const slider = document.getElementById('gripper');
    if (slider) {
        slider.addEventListener('input', function (e) {
            document.getElementById('gripper-val').textContent = e.target.value;
        });
    }

    // Keyboard Shortcuts
    document.addEventListener('keydown', function (e) {
        // Robust check for input focus
        const tag = e.target.tagName.toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) {
            return;
        }

        if (e.ctrlKey || e.metaKey) {
            switch (e.key.toLowerCase()) {
                case 'x':
                    e.preventDefault();
                    cutSelection();
                    break;
                case 'c':
                    e.preventDefault();
                    copySelection();
                    break;
                case 'v':
                    e.preventDefault();
                    pasteSelection();
                    break;
                case 'z':
                    e.preventDefault();
                    if (e.shiftKey) redo();
                    else undo();
                    break;
                case 'y':
                    e.preventDefault();
                    redo();
                    break;
            }
        }
        // Delete key to remove selection
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (selectionSet.size > 0) {
                e.preventDefault();
                saveState();
                const paths = getSortedSelection();
                paths.forEach(p => removeNodeByPath(p));
                selectionSet.clear();
                renderPoseList();
            }
        }
    });
};
