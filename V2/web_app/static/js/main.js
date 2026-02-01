// Main Logic for Piper Web App

// Global state
let latestPose = null;
let poseList = [];
let isPlaying = false;
let dragSrcEl = null;

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

    // Only update UI if not dragging slider (to avoid feedback loop fighting)
    // Actually this funct is called by slider too.
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
        rz: parseFloat(document.getElementById('ep_rz').value),
        gripper: parseInt(document.getElementById('gripper').value)
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
        j6: parseFloat(document.getElementById('j6').value),
        gripper: parseInt(document.getElementById('gripper').value)
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
        gripper: pose.gripper,
        effort: pose.effort || 1000,
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

// --- Sequencer Logic ---

function capturePose() {
    const j1 = parseFloat(document.getElementById('fb_j1').value) || 0;
    const j2 = parseFloat(document.getElementById('fb_j2').value) || 0;
    const j3 = parseFloat(document.getElementById('fb_j3').value) || 0;
    const j4 = parseFloat(document.getElementById('fb_j4').value) || 0;
    const j5 = parseFloat(document.getElementById('fb_j5').value) || 0;
    const j6 = parseFloat(document.getElementById('fb_j6').value) || 0;
    const gripper = parseInt(document.getElementById('gripper').value) || 0;
    const effort = parseInt(document.getElementById('gripper-effort').value) || 1000;

    const pose = {
        type: 'pose',
        name: `Pose ${poseList.length + 1}`,
        joints: [j1, j2, j3, j4, j5, j6],
        end_pose: latestPose ? [latestPose.x, latestPose.y, latestPose.z, latestPose.rx, latestPose.ry, latestPose.rz] : [0, 0, 0, 0, 0, 0],
        gripper: gripper,
        effort: effort,
        speed: 50,
        duration: 2000,
        move_mode: 0x01
    };

    poseList.push(pose);
    renderPoseList();
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
    poseList.push(action);
    renderPoseList();
}

function renderPoseList() {
    const list = document.getElementById('pose-list');
    list.innerHTML = '';

    poseList.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = 'pose-item';
        li.draggable = true;
        li.dataset.index = index;

        // Drag Events
        li.addEventListener('dragstart', handleDragStart);
        li.addEventListener('dragover', handleDragOver);
        li.addEventListener('drop', handleDrop);
        li.addEventListener('dragenter', handleDragEnter);
        li.addEventListener('dragleave', handleDragLeave);

        // Name
        const inputName = document.createElement('input');
        inputName.type = 'text';
        inputName.className = 'pose-name';
        inputName.value = item.name;
        inputName.onchange = (e) => { item.name = e.target.value; };
        inputName.style.flexGrow = '2';

        // Speed
        const inputSpeed = document.createElement('input');
        inputSpeed.type = 'number';
        inputSpeed.className = 'pose-name';
        inputSpeed.value = item.speed;
        inputSpeed.placeholder = 'Spd';
        inputSpeed.title = 'Speed (0-100)';
        inputSpeed.style.width = '50px';
        inputSpeed.style.flexGrow = '0';
        inputSpeed.onchange = (e) => { item.speed = parseInt(e.target.value); };

        // Duration
        const inputDur = document.createElement('input');
        inputDur.type = 'number';
        inputDur.className = 'pose-name';
        inputDur.value = item.duration;
        inputDur.placeholder = 'ms';
        inputDur.title = 'Wait Duration (ms)';
        inputDur.style.width = '60px';
        inputDur.style.flexGrow = '0';
        inputDur.onchange = (e) => { item.duration = parseInt(e.target.value); };

        // Linear Checkbox
        const lblLin = document.createElement('label');
        lblLin.style.fontSize = '12px';
        lblLin.style.display = 'flex';
        lblLin.style.alignItems = 'center';
        const chkLin = document.createElement('input');
        chkLin.type = 'checkbox';
        chkLin.checked = item.move_mode === 0x02;
        chkLin.onchange = (e) => { item.move_mode = e.target.checked ? 0x02 : 0x01; };
        lblLin.appendChild(chkLin);
        lblLin.appendChild(document.createTextNode('Linear'));

        // Display
        const span = document.createElement('span');
        span.className = 'pose-conf';

        if (item.type === 'gripper') {
            span.textContent = ``;
        } else {
            span.textContent = `[${item.joints.map(j => Math.round(j)).join(', ')}] G:${item.gripper}`;
        }

        // Play Button
        const btnPlay = document.createElement('button');
        btnPlay.className = 'btn-sm secondary';
        btnPlay.textContent = '▶';
        btnPlay.onclick = () => {
            if (item.type === 'gripper') moveGripper(item.value, item.effort || 1000);
            else moveToPose(item);
        };

        // Delete Button
        const btnDel = document.createElement('button');
        btnDel.className = 'btn-sm error-btn';
        btnDel.textContent = '✕';
        btnDel.onclick = () => deletePose(index);

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
            addLbl('Spd:');
            li.appendChild(inputSpeed);
            li.appendChild(lblLin);
        } else if (item.type === 'gripper') {
            // Gripper Pos
            const inputGripPos = document.createElement('input');
            inputGripPos.type = 'number';
            inputGripPos.className = 'pose-name';
            inputGripPos.value = item.value;
            inputGripPos.placeholder = 'Pos';
            inputGripPos.title = 'Position (0-100)';
            inputGripPos.style.width = '50px';
            inputGripPos.style.flexGrow = '0';
            inputGripPos.onchange = (e) => { item.value = parseInt(e.target.value); };
            addLbl('Pos:');
            li.appendChild(inputGripPos);

            // Effort
            const inputGripEff = document.createElement('input');
            inputGripEff.type = 'number';
            inputGripEff.className = 'pose-name';
            inputGripEff.value = item.effort || 1000;
            inputGripEff.placeholder = 'Force';
            inputGripEff.title = 'Force';
            inputGripEff.style.width = '60px';
            inputGripEff.style.flexGrow = '0';
            inputGripEff.onchange = (e) => { item.effort = parseInt(e.target.value); };
            addLbl('Force:');
            li.appendChild(inputGripEff);
        }

        addLbl('Wait:');
        li.appendChild(inputDur);
        li.appendChild(span);
        li.appendChild(btnPlay);
        li.appendChild(btnDel);
        list.appendChild(li);
    });
}

function deletePose(index) {
    poseList.splice(index, 1);
    renderPoseList();
}

async function playSequence() {
    if (isPlaying) return;
    isPlaying = true;
    const interval = parseFloat(document.getElementById('seq-interval').value) * 1000 || 2000;
    const statusEl = document.getElementById('status');
    statusEl.textContent = 'Starting sequence...';

    for (let i = 0; i < poseList.length; i++) {
        if (!isPlaying) break;
        const item = poseList[i];
        if (item.type === 'gripper') {
            await moveGripper(item.value, item.effort || 1000);
        } else {
            await moveToPose(item);
        }
        const waitTime = item.duration || 1000;
        await new Promise(r => setTimeout(r, waitTime));
    }
    isPlaying = false;
    statusEl.textContent = 'Sequence finished';
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


// --- Drag & Drop ---
function handleDragStart(e) {
    dragSrcEl = this;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
    this.classList.add('dragging');
}

function handleDragOver(e) {
    if (e.preventDefault) e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDragEnter(e) {
    this.classList.add('over');
}

function handleDragLeave(e) {
    this.classList.remove('over');
}

function handleDrop(e) {
    if (e.stopPropagation) e.stopPropagation();
    if (dragSrcEl != this) {
        const srcIdx = parseInt(dragSrcEl.dataset.index);
        const destIdx = parseInt(this.dataset.index);
        const item = poseList.splice(srcIdx, 1)[0];
        poseList.splice(destIdx, 0, item);
        renderPoseList();
    }
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
};
