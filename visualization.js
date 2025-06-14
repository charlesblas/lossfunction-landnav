// Three.js scene setup
let scene, camera, renderer, controls;
let terrain, helicopter, pathLines = [];
let currentStrategy = 'aerial';
let isExploring = false;
let animationId;
let explorationHistory = [];
let currentPosition = { x: 0, z: 0 };
let targetPosition = { x: 0, z: 0 };
let speed = 5;
let jumpSize = 50;
let showHeatmap = false;
let heatmapMesh = null;
let fastForwardMode = false;
let fastForwardSteps = 0;

// Loss function parameters
const lossFunction = (x, z) => {
    // Complex loss landscape with multiple minima
    const term1 = 0.5 * (Math.sin(x * 0.5) * Math.cos(z * 0.5) + 1);
    const term2 = 0.3 * Math.exp(-((x - 5) ** 2 + (z - 5) ** 2) / 20);
    const term3 = 0.7 * Math.exp(-((x + 3) ** 2 + (z + 3) ** 2) / 15);
    const term4 = 0.9 * Math.exp(-((x - 8) ** 2 + (z + 6) ** 2) / 25); // Global minimum
    const noise = 0.1 * (Math.sin(x * 2) * Math.cos(z * 2));
    
    return 10 - (term1 + term2 + term3 + term4) * 10 + noise;
};

// Initialize Three.js scene
function initScene() {
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0a0a0a, 50, 200);

    // Camera setup
    camera = new THREE.PerspectiveCamera(
        75,
        document.getElementById('terrain-viz').clientWidth / 600,
        0.1,
        1000
    );
    camera.position.set(30, 40, 30);
    camera.lookAt(0, 0, 0);

    // Renderer setup
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(document.getElementById('terrain-viz').clientWidth, 600);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('terrain-viz').appendChild(renderer.domElement);

    // Controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxDistance = 100;
    controls.minDistance = 10;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(50, 50, 50);
    directionalLight.castShadow = true;
    directionalLight.shadow.camera.near = 0.1;
    directionalLight.shadow.camera.far = 200;
    directionalLight.shadow.camera.left = -50;
    directionalLight.shadow.camera.right = 50;
    directionalLight.shadow.camera.top = 50;
    directionalLight.shadow.camera.bottom = -50;
    scene.add(directionalLight);

    // Create terrain
    createTerrain();

    // Create helicopter
    createHelicopter();

    // Start animation loop
    animate();
}

// Create 3D terrain from loss function
function createTerrain() {
    const size = 40;
    const segments = 100;
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    
    // Modify vertices based on loss function
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const z = positions.getZ(i);
        const y = -lossFunction(x, z);
        positions.setY(i, y);
    }
    
    geometry.computeVertexNormals();
    
    // Create gradient material
    const material = new THREE.ShaderMaterial({
        uniforms: {
            lowColor: { value: new THREE.Color(0x667eea) },
            highColor: { value: new THREE.Color(0xff0066) }
        },
        vertexShader: `
            varying float vElevation;
            void main() {
                vElevation = position.y;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 lowColor;
            uniform vec3 highColor;
            varying float vElevation;
            void main() {
                float t = (vElevation + 10.0) / 10.0;
                vec3 color = mix(lowColor, highColor, t);
                gl_FragColor = vec4(color, 1.0);
            }
        `,
        side: THREE.DoubleSide
    });
    
    terrain = new THREE.Mesh(geometry, material);
    terrain.rotation.x = -Math.PI / 2;
    terrain.receiveShadow = true;
    scene.add(terrain);

    // Add wireframe overlay
    const wireframe = new THREE.WireframeGeometry(geometry);
    const wireframeMaterial = new THREE.LineBasicMaterial({ 
        color: 0x222222, 
        opacity: 0.3, 
        transparent: true 
    });
    const wireframeMesh = new THREE.LineSegments(wireframe, wireframeMaterial);
    wireframeMesh.rotation.x = -Math.PI / 2;
    scene.add(wireframeMesh);
}

// Create helicopter mesh
function createHelicopter() {
    const group = new THREE.Group();
    
    // Body
    const bodyGeometry = new THREE.SphereGeometry(0.5, 16, 16);
    const bodyMaterial = new THREE.MeshPhongMaterial({ 
        color: 0x00ff00,
        emissive: 0x00ff00,
        emissiveIntensity: 0.2
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.castShadow = true;
    group.add(body);
    
    // Rotor
    const rotorGeometry = new THREE.CylinderGeometry(1.5, 1.5, 0.1, 6);
    const rotorMaterial = new THREE.MeshPhongMaterial({ 
        color: 0x444444,
        opacity: 0.6,
        transparent: true
    });
    const rotor = new THREE.Mesh(rotorGeometry, rotorMaterial);
    rotor.position.y = 0.6;
    group.add(rotor);
    
    // Add point light
    const light = new THREE.PointLight(0x00ff00, 1, 10);
    light.position.y = -1;
    group.add(light);
    
    helicopter = group;
    updateHelicopterPosition();
    scene.add(helicopter);
}

// Update helicopter position
function updateHelicopterPosition() {
    const y = -lossFunction(currentPosition.x, currentPosition.z) + 2;
    helicopter.position.set(currentPosition.x, y, currentPosition.z);
    
    // Update UI
    document.getElementById('x-pos').textContent = currentPosition.x.toFixed(2);
    document.getElementById('z-pos').textContent = currentPosition.z.toFixed(2);
    document.getElementById('loss-value').textContent = lossFunction(currentPosition.x, currentPosition.z).toFixed(3);
}

// Add exploration path visualization
function addPathSegment(from, to, color = null) {
    // Calculate color based on loss improvement
    if (!color) {
        const fromLoss = lossFunction(from.x, from.z);
        const toLoss = lossFunction(to.x, to.z);
        const improvement = fromLoss - toLoss;
        
        // Create gradient from red (worse) to green (better)
        const hue = improvement > 0 ? 120 : 0; // Green if improving, red if not
        const saturation = Math.abs(improvement) * 20;
        const lightness = 50 + Math.abs(improvement) * 10;
        color = new THREE.Color(`hsl(${hue}, ${saturation}%, ${lightness}%)`);
    }
    
    const points = [];
    const steps = 20; // Smooth curve
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = from.x + (to.x - from.x) * t;
        const z = from.z + (to.z - from.z) * t;
        const y = -lossFunction(x, z) + 0.5 + Math.sin(t * Math.PI) * 2; // Arc effect
        points.push(new THREE.Vector3(x, y, z));
    }
    
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ 
        color: color,
        opacity: 0.8,
        transparent: true,
        linewidth: 2
    });
    const line = new THREE.Line(geometry, material);
    
    // Add glow effect
    const glowMaterial = new THREE.LineBasicMaterial({
        color: color,
        opacity: 0.3,
        transparent: true,
        linewidth: 5
    });
    const glowLine = new THREE.Line(geometry, glowMaterial);
    
    scene.add(line);
    scene.add(glowLine);
    pathLines.push(line);
    pathLines.push(glowLine);
}

// Create exploration heatmap
function updateHeatmap() {
    if (heatmapMesh) {
        scene.remove(heatmapMesh);
    }
    
    if (!showHeatmap || explorationHistory.length === 0) return;
    
    const size = 40;
    const resolution = 50;
    const canvas = document.createElement('canvas');
    canvas.width = resolution;
    canvas.height = resolution;
    const ctx = canvas.getContext('2d');
    
    // Create gradient based on exploration density
    const imageData = ctx.createImageData(resolution, resolution);
    const data = imageData.data;
    
    for (let i = 0; i < resolution; i++) {
        for (let j = 0; j < resolution; j++) {
            const x = (i / resolution - 0.5) * size;
            const z = (j / resolution - 0.5) * size;
            
            // Calculate density based on proximity to exploration points
            let density = 0;
            for (const point of explorationHistory) {
                const dist = Math.sqrt((x - point.x) ** 2 + (z - point.z) ** 2);
                density += Math.exp(-dist * dist / 10) * (10 - point.loss) / 10;
            }
            
            // Convert density to color
            const idx = (i + j * resolution) * 4;
            const intensity = Math.min(density * 50, 255);
            
            // Purple to yellow gradient
            data[idx] = 100 + intensity * 0.6;     // R
            data[idx + 1] = 50 + intensity * 0.8;  // G
            data[idx + 2] = 200 - intensity * 0.5; // B
            data[idx + 3] = intensity;             // A
        }
    }
    
    ctx.putImageData(imageData, 0, 0);
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    
    const heatmapGeometry = new THREE.PlaneGeometry(size, size);
    const heatmapMaterial = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide
    });
    
    heatmapMesh = new THREE.Mesh(heatmapGeometry, heatmapMaterial);
    heatmapMesh.rotation.x = -Math.PI / 2;
    heatmapMesh.position.y = -9.5;
    scene.add(heatmapMesh);
}

// Strategy implementations
const strategies = {
    aerial: {
        name: "Aerial Survey",
        description: "Make large jumps across parameter space to identify global terrain features.",
        execute: () => {
            // Random large jumps
            targetPosition = {
                x: (Math.random() - 0.5) * 30,
                z: (Math.random() - 0.5) * 30
            };
        }
    },
    grid: {
        name: "Grid Search",
        description: "Systematically sample points in a grid pattern across the landscape.",
        gridIndex: 0,
        execute: function() {
            const gridSize = 5;
            const step = 30 / gridSize;
            const i = this.gridIndex % gridSize;
            const j = Math.floor(this.gridIndex / gridSize) % gridSize;
            
            targetPosition = {
                x: -15 + i * step,
                z: -15 + j * step
            };
            
            this.gridIndex++;
        }
    },
    spiral: {
        name: "Spiral Search",
        description: "Spiral outward from current best position to ensure thorough local exploration.",
        angle: 0,
        radius: 2,
        execute: function() {
            this.angle += Math.PI / 4;
            this.radius += 0.5;
            if (this.radius > 15) {
                this.radius = 2;
            }
            
            targetPosition = {
                x: currentPosition.x + Math.cos(this.angle) * this.radius,
                z: currentPosition.z + Math.sin(this.angle) * this.radius
            };
        }
    },
    direct: {
        name: "Direct Descent",
        description: "Drop directly to the lowest point found, then fine-tune locally.",
        execute: () => {
            // Find best position from history or use current
            let bestPos = currentPosition;
            let bestLoss = lossFunction(currentPosition.x, currentPosition.z);
            
            for (const entry of explorationHistory) {
                if (entry.loss < bestLoss) {
                    bestLoss = entry.loss;
                    bestPos = { x: entry.x, z: entry.z };
                }
            }
            
            // Small random adjustment from best position
            targetPosition = {
                x: bestPos.x + (Math.random() - 0.5) * 2,
                z: bestPos.z + (Math.random() - 0.5) * 2
            };
        }
    }
};

// Animation loop
function animate() {
    animationId = requestAnimationFrame(animate);
    
    // Update controls
    controls.update();
    
    // Rotate helicopter rotor
    if (helicopter.children[1]) {
        helicopter.children[1].rotation.y += 0.2;
    }
    
    // Fast forward mode
    if (fastForwardMode && fastForwardSteps > 0) {
        for (let i = 0; i < 50 && fastForwardSteps > 0; i++) {
            const prevPos = { x: currentPosition.x, z: currentPosition.z };
            
            // Execute strategy
            strategies[currentStrategy].execute();
            currentPosition = { ...targetPosition };
            
            // Record history
            const loss = lossFunction(currentPosition.x, currentPosition.z);
            explorationHistory.push({
                x: currentPosition.x,
                z: currentPosition.z,
                loss: loss,
                strategy: currentStrategy
            });
            
            // Add path segment
            addPathSegment(prevPos, currentPosition);
            
            // Cycle through strategies for variety
            if (fastForwardSteps % 25 === 0) {
                const strategyKeys = Object.keys(strategies);
                const currentIndex = strategyKeys.indexOf(currentStrategy);
                currentStrategy = strategyKeys[(currentIndex + 1) % strategyKeys.length];
            }
            
            fastForwardSteps--;
        }
        
        updateHelicopterPosition();
        updateHeatmap();
        
        if (fastForwardSteps === 0) {
            fastForwardMode = false;
            addHistoryEntry("Fast Forward Complete", currentPosition, lossFunction(currentPosition.x, currentPosition.z));
        }
    }
    
    // Normal exploration mode
    else if (isExploring && targetPosition) {
        const prevPos = { x: currentPosition.x, z: currentPosition.z };
        const dx = targetPosition.x - currentPosition.x;
        const dz = targetPosition.z - currentPosition.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance > 0.1) {
            const step = Math.min(distance, speed * 0.01 * (jumpSize / 50));
            currentPosition.x += (dx / distance) * step;
            currentPosition.z += (dz / distance) * step;
            updateHelicopterPosition();
        } else {
            // Reached target
            const loss = lossFunction(currentPosition.x, currentPosition.z);
            explorationHistory.push({
                x: currentPosition.x,
                z: currentPosition.z,
                loss: loss,
                strategy: currentStrategy
            });
            
            // Add path visualization
            addPathSegment(prevPos, currentPosition);
            
            // Add to history log
            addHistoryEntry(currentStrategy, currentPosition, loss);
            
            // Update heatmap
            updateHeatmap();
            
            // Execute next step
            strategies[currentStrategy].execute();
        }
    }
    
    renderer.render(scene, camera);
}

// Add history entry to UI
function addHistoryEntry(strategy, position, loss) {
    const historyLog = document.getElementById('history-log');
    const entry = document.createElement('div');
    entry.className = 'history-entry';
    entry.textContent = `${strategy}: (${position.x.toFixed(1)}, ${position.z.toFixed(1)}) → Loss: ${loss.toFixed(3)}`;
    historyLog.insertBefore(entry, historyLog.firstChild);
    
    // Keep only last 10 entries
    while (historyLog.children.length > 10) {
        historyLog.removeChild(historyLog.lastChild);
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    initScene();
    
    // Strategy buttons
    document.querySelectorAll('.strategy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.strategy-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentStrategy = e.target.dataset.strategy;
            document.getElementById('strategy-description').textContent = 
                strategies[currentStrategy].description;
        });
    });
    
    // Control buttons
    document.getElementById('start-exploration').addEventListener('click', (e) => {
        isExploring = !isExploring;
        e.target.textContent = isExploring ? 'Stop Exploration' : 'Start Exploration';
        if (isExploring) {
            strategies[currentStrategy].execute();
        }
    });
    
    document.getElementById('fast-forward').addEventListener('click', () => {
        fastForwardMode = true;
        fastForwardSteps = 200; // Run 200 exploration steps
        isExploring = false;
        document.getElementById('start-exploration').textContent = 'Start Exploration';
    });
    
    document.getElementById('reset-view').addEventListener('click', () => {
        // Reset camera
        camera.position.set(30, 40, 30);
        camera.lookAt(0, 0, 0);
        controls.update();
        
        // Reset position
        currentPosition = { x: 0, z: 0 };
        updateHelicopterPosition();
        
        // Clear paths
        pathLines.forEach(line => scene.remove(line));
        pathLines = [];
        
        // Clear history
        explorationHistory = [];
        document.getElementById('history-log').innerHTML = '';
        
        // Clear heatmap
        if (heatmapMesh) {
            scene.remove(heatmapMesh);
            heatmapMesh = null;
        }
        
        // Reset strategy states
        strategies.grid.gridIndex = 0;
        strategies.spiral.angle = 0;
        strategies.spiral.radius = 2;
    });
    
    // Heatmap checkbox
    document.getElementById('show-heatmap').addEventListener('change', (e) => {
        showHeatmap = e.target.checked;
        updateHeatmap();
    });
    
    // Sliders
    document.getElementById('speed-slider').addEventListener('input', (e) => {
        speed = parseInt(e.target.value);
    });
    
    document.getElementById('jump-slider').addEventListener('input', (e) => {
        jumpSize = parseInt(e.target.value);
    });
    
    // Window resize
    window.addEventListener('resize', () => {
        const width = document.getElementById('terrain-viz').clientWidth;
        camera.aspect = width / 600;
        camera.updateProjectionMatrix();
        renderer.setSize(width, 600);
    });
});