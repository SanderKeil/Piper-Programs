// 3D Visualization Logic for Piper Robot

window.Piper3D = (function () {
    let scene, camera, renderer, robotJointGroups = [];

    // Exact DH Params from piper_fk.py (dh_is_offset = 0x01)
    // a (mm -> m), alpha (rad), d (mm -> m), theta_offset (rad)
    const DHParams = [
        { a: 0.0, alpha: 0.0, d: 0.123, theta: 0.0 },
        { a: 0.0, alpha: -1.570796327, d: 0.0, theta: -172.22 * Math.PI / 180 },
        { a: 0.28503, alpha: 0.0, d: 0.0, theta: -102.78 * Math.PI / 180 },
        { a: -0.02198, alpha: 1.570796327, d: 0.25075, theta: 0.0 },
        { a: 0.0, alpha: -1.570796327, d: 0.0, theta: 0.0 },
        { a: 0.0, alpha: 1.570796327, d: 0.091, theta: 0.0 }
    ];

    function calculateLinkMatrix(alpha, a, theta, d) {
        const calpha = Math.cos(alpha);
        const salpha = Math.sin(alpha);
        const ctheta = Math.cos(theta);
        const stheta = Math.sin(theta);

        const m = new THREE.Matrix4();
        m.set(
            ctheta, -stheta, 0, a,
            stheta * calpha, ctheta * calpha, -salpha, -d * salpha,
            stheta * salpha, ctheta * salpha, calpha, d * calpha,
            0, 0, 0, 1
        );
        return m;
    }

    function buildPiperModel(targetScene) {
        const matLink = new THREE.MeshPhongMaterial({ color: 0xeeeeee });
        const matJoint = new THREE.MeshPhongMaterial({ color: 0x333333 });
        const matGripper = new THREE.MeshPhongMaterial({ color: 0x555555 });

        const jointGroups = [];

        // Root group to align Z-up robot to Y-up scene
        const robotRoot = new THREE.Group();
        robotRoot.rotation.x = -Math.PI / 2;
        targetScene.add(robotRoot);

        let parent = robotRoot;

        // Base Visual (Fixed to Root)
        const mBase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 32), matJoint);
        mBase.rotation.x = Math.PI / 2; // Cylinder along Z (up in robot frame)
        mBase.position.z = 0.02;
        robotRoot.add(mBase);

        // Create Chain of Groups (Frames)
        for (let i = 0; i < 6; i++) {
            const g = new THREE.Group();
            parent.add(g);
            jointGroups.push(g);
            parent = g;
        }

        const jg = jointGroups;

        // --- Visuals attached to Frames ---

        // J1 Housing (Base Turret)
        const j1Housing = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 32), matJoint);
        j1Housing.rotation.x = Math.PI / 2;
        j1Housing.position.z = -0.05;
        jg[0].add(j1Housing);

        // Link 1 (Vertical Post)
        const link1 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.123, 32), matLink);
        link1.rotation.x = Math.PI / 2;
        link1.position.z = -0.123 / 2;
        jg[0].add(link1);

        // J2 (Shoulder) Housing
        const j2Housing = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 32), matJoint);
        j2Housing.rotation.x = Math.PI / 2;
        jg[1].add(j2Housing);

        // Link 2 (Upper Arm)
        const link2 = new THREE.Mesh(new THREE.BoxGeometry(0.285, 0.05, 0.05), matLink);
        link2.position.x = 0.285 / 2;
        jg[1].add(link2);

        // J3 (Elbow) Housing
        const j3Housing = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 32), matJoint);
        j3Housing.rotation.x = Math.PI / 2;
        jg[2].add(j3Housing);

        // Link 3 (Forearm)
        const link3 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2125, 0.04), matLink);
        const tilt = -Math.atan(0.02198 / 0.25075);
        link3.rotation.z = tilt;
        link3.position.y = -0.25075 / 2;
        link3.position.x = -0.02198 / 2;
        jg[2].add(link3);

        // J4 (Wrist 1) Housing
        const j4Housing = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.05, 32), matJoint);
        j4Housing.rotation.x = Math.PI / 2;
        j4Housing.position.z = -0.04;
        jg[3].add(j4Housing);

        // J5 (Wrist 2) Housing
        const j5Housing = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 32), matJoint);
        j5Housing.rotation.x = Math.PI / 2;
        jg[4].add(j5Housing);

        // J6 (Wrist 3) Housing
        const j6Housing = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 32), matJoint);
        j6Housing.rotation.x = Math.PI / 2;
        jg[5].add(j6Housing);

        // Gripper
        const grp = new THREE.Group();
        grp.position.z = 0.091;
        grp.rotation.z = Math.PI / 2;
        jg[5].add(grp);

        const grpBase = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.08), matGripper);
        grp.add(grpBase);

        const fL = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.02, 0.06), matGripper);
        fL.position.set(0.015, 0, 0.07);
        fL.name = "FingerL";
        grp.add(fL);

        const fR = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.02, 0.06), matGripper);
        fR.position.set(-0.015, 0, 0.07);
        fR.name = "FingerR";
        grp.add(fR);

        return jointGroups;
    }

    // --- Thumbnail Logic ---
    let thumbScene, thumbCamera, thumbRenderer, thumbJointGroups = [];

    function initThumbSystem() {
        thumbScene = new THREE.Scene();
        thumbScene.background = new THREE.Color(0x333333); // Dark background for icon

        // Small square aspect
        thumbCamera = new THREE.PerspectiveCamera(45, 1, 0.01, 10);
        thumbCamera.position.set(0.6, 0.4, 0.6); // Slightly closer/different angle?
        thumbCamera.lookAt(0, 0.1, 0);

        thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        thumbRenderer.setSize(128, 128); // Higher res for larger icon

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        thumbScene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(2, 5, 2);
        thumbScene.add(dirLight);

        thumbJointGroups = buildPiperModel(thumbScene);
    }

    function generateThumbnail(joints, gripperValue) {
        if (!thumbRenderer) initThumbSystem();

        // Update Thumb Robot
        // Copied from update() logic but for thumbJointGroups
        for (let i = 0; i < 6; i++) {
            const group = thumbJointGroups[i];
            const deg = joints[i] || 0;
            const rad = deg * Math.PI / 180;
            const p = DHParams[i];
            const currentTheta = rad + p.theta;
            const m = calculateLinkMatrix(p.alpha, p.a, currentTheta, p.d);
            group.matrix.copy(m);
            group.matrixAutoUpdate = false;
        }

        // Update Gripper
        if (gripperValue === undefined) gripperValue = 0;
        const halfWidth = (gripperValue / 1000.0) / 2.0;

        const g6 = thumbJointGroups[5];
        const fingerL = g6.getObjectByName("FingerL");
        const fingerR = g6.getObjectByName("FingerR");

        if (fingerL && fingerR) {
            const minPos = 0.015;
            fingerL.position.x = minPos + halfWidth;
            fingerR.position.x = -(minPos + halfWidth);
        }

        // Render
        thumbRenderer.render(thumbScene, thumbCamera);
        return thumbRenderer.domElement.toDataURL('image/png');
    }

    function init() {
        console.log("Initializing Piper3D...");
        const container = document.getElementById('canvas-container');
        if (!container) {
            console.error("Canvas container not found!");
            return;
        }
        const width = container.clientWidth;
        const height = container.clientHeight;

        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x1a1a1a);

        camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 10);
        camera.position.set(0.8, 0.5, 0.8);
        camera.lookAt(0, 0.2, 0);

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(width, height);
        container.appendChild(renderer.domElement);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(2, 5, 2);
        scene.add(dirLight);

        const gridHelper = new THREE.GridHelper(1, 10, 0x555555, 0x333333);
        scene.add(gridHelper);
        const axesHelper = new THREE.AxesHelper(0.3);
        axesHelper.rotation.x = -Math.PI / 2;
        scene.add(axesHelper);

        const controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.target.set(0, 0.2, 0);

        robotJointGroups = buildPiperModel(scene);

        function animate() {
            requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        }
        animate();

        window.addEventListener('resize', () => {
            const w = container.clientWidth;
            const h = container.clientHeight;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        });

        // Initialize thumb system proactively
        initThumbSystem();
    }

    function update(angles, gripperValue) {
        if (robotJointGroups.length === 0) return;

        for (let i = 0; i < 6; i++) {
            const group = robotJointGroups[i];
            const deg = angles[i] || 0;
            const rad = deg * Math.PI / 180;
            const p = DHParams[i];
            const currentTheta = rad + p.theta;
            const m = calculateLinkMatrix(p.alpha, p.a, currentTheta, p.d);
            group.matrix.copy(m);
            group.matrixAutoUpdate = false;
        }

        if (gripperValue === undefined) gripperValue = 0;
        const halfWidth = (gripperValue / 1000.0) / 2.0;

        const g6 = robotJointGroups[5];
        const fingerL = g6.getObjectByName("FingerL");
        const fingerR = g6.getObjectByName("FingerR");

        if (fingerL && fingerR) {
            const minPos = 0.015;
            fingerL.position.x = minPos + halfWidth;
            fingerR.position.x = -(minPos + halfWidth);
        }
    }

    return {
        init: init,
        update: update,
        generateThumbnail: generateThumbnail
    };

})();
