// ==========================================
// 1. VARIABLES GLOBALES Y CONFIGURACIÓN
// ==========================================
const audio = document.getElementById('audio-element');
const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');

// API de música (Reemplaza con tu token si es necesario)
const JAMENDO_CLIENT_ID = '549df9c9'; 

// Estado del reproductor y la cola
let colaDeReproduccion = [];
let indiceActual = 0;

// Nodos de la Web Audio API
let audioCtx, analyser, source;
let filters = [];          // Para el Ecualizador
let pannerNode;           // Para el Panning (Izquierda/Derecha)
let filtroDistancia;      // Para el Low Pass Filter (Agudos/Bajos)
let reverbGainNode;       // Para simular la reverberación

// Variables para el arrastre del punto de sonido espacial
let isDragging = false;
const spatialContainer = document.getElementById('spatial-container'); // Tu recuadro de sonido
const soundDot = document.getElementById('sound-dot');               // El punto blanco

// ==========================================
// 2. SISTEMA DE PESTAÑAS (NAVEGACIÓN)
// ==========================================
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    if (event) event.currentTarget.classList.add('active');
}

// ==========================================
// 3. MOTOR DE AUDIO CENTRAL (CONEXIONES)
// ==========================================
function initAudioEngine() {
    if (audioCtx) return; // Si ya está inicializado, no hacer nada

    // Crear el contexto de audio
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    source = audioCtx.createMediaElementSource(audio);
    analyser = audioCtx.createAnalyser();
    
    // --- NODO 1: Panning Estéreo ---
    pannerNode = audioCtx.createStereoPanner();
    
    // --- NODO 2: Filtro de Distancia (Lowpass) ---
    filtroDistancia = audioCtx.createBiquadFilter();
    filtroDistancia.type = 'lowpass';
    filtroDistancia.frequency.value = 20000; // Totalmente abierto al inicio

    // --- NODO 3: Ganancia de Reverb ---
    reverbGainNode = audioCtx.createGain();
    reverbGainNode.gain.value = 0; // Sin reverb al inicio

    // --- NODOS 4 al 8: Ecualizador de 5 Bandas ---
    const frecuencias = [60, 230, 910, 4000, 14000];
    let lastFilter = source;

    frecuencias.forEach((freq) => {
        let filter = audioCtx.createBiquadFilter();
        filter.type = (freq === 60) ? "lowshelf" : (freq === 14000) ? "highshelf" : "peaking";
        filter.frequency.value = freq;
        filter.Q.value = 1;
        filter.gain.value = 0; // 0 dB por defecto

        lastFilter.connect(filter);
        filters.push(filter);
        lastFilter = filter;
    });

    // --- CONEXIÓN DE LA CADENA ---
    // Cadena principal: Source -> EQ -> Panner -> Filtro Distancia -> Analyser -> Destino (Altavoces)
    lastFilter.connect(pannerNode);
    pannerNode.connect(filtroDistancia);
    filtroDistancia.connect(analyser);
    analyser.connect(audioCtx.destination);

    // Conexión paralela para efectos espaciales (Enrutamiento hacia efectos)
    filtroDistancia.connect(reverbGainNode);
    reverbGainNode.connect(audioCtx.destination);

    // Arrancar el visualizador de fondo
    setupVisualizer();
}

// ==========================================
// 4. VISUALIZADOR DE FONDO (CAMUFLADO)
// ==========================================
function setupVisualizer() {
    analyser.fftSize = 128;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
        requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);

        // Limpiar canvas con el fondo negro de tu app
        ctx.fillStyle = '#121212';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const barWidth = (canvas.width / bufferLength) * 1.5;
        let barHeight;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            barHeight = dataArray[i] / 1.5;
            // Verde Spotify/Neón con opacidad basada en el ritmo para camuflarse
            ctx.fillStyle = `rgba(29, 185, 84, ${barHeight / 200})`; 
            ctx.fillRect(x, canvas.height - barHeight, barWidth - 2, barHeight);
            x += barWidth;
        }
    }
    draw();
}

// ==========================================
// 5. SISTEMA DE SONIDO ESPACIAL (FÍSICA)
// ==========================================
function actualizarSonidoEspacial(x, y) {
    if (!audioCtx) return;

    // x, y vienen normalizados entre -1 y 1 desde el contenedor
    // 1. Panning (Izquierda / Derecha)
    pannerNode.pan.setValueAtTime(x, audioCtx.currentTime);
    
    // 2. Distancia euclidiana desde el centro (0,0)
    const distancia = Math.sqrt(x * x + y * y); 
    const maxDistancia = Math.sqrt(2); 
    const factorDistancia = Math.min(distancia / maxDistancia, 1); // Escala 0 a 1

    // Aumentar la sensación de Reverb a medida que se aleja del centro
    reverbGainNode.gain.setValueAtTime(factorDistancia * 0.6, audioCtx.currentTime);

    // Filtro Lowpass: Si se aleja, ahoga los agudos (baja de 20kHz a 1.5kHz)
    // Los bajos se mantienen dominantes de forma natural
    const frecuenciaCorte = 20000 - (factorDistancia * 18500);
    filtroDistancia.frequency.setValueAtTime(frecuenciaCorte, audioCtx.currentTime);
}

// Interacción del mouse para mover el punto blanco
if (spatialContainer && soundDot) {
    spatialContainer.addEventListener('mousedown', () => isDragging = true);
    window.addEventListener('mouseup', () => isDragging = false);
    
    spatialContainer.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        initAudioEngine();

        const rect = spatialContainer.getBoundingClientRect();
        let posX = e.clientX - rect.left;
        let posY = e.clientY - rect.top;

        // Mantener el punto dentro de los límites del contenedor
        posX = Math.max(0, Math.min(posX, rect.width));
        posY = Math.max(0, Math.min(posY, rect.height));

        soundDot.style.left = `${posX}px`;
        soundDot.style.top = `${posY}px`;

        // Convertir coordenadas a rango matemático (-1 a 1) siendo el centro (0,0)
        const normalizedX = ((posX / rect.width) * 2) - 1;
        const normalizedY = -(((posY / rect.height) * 2) - 1); // Invertido para eje Y estándar

        actualizarSonidoEspacial(normalizedX, normalizedY);
    });
}

// ==========================================
// 6. MÚSICA ONLINE (APIS) Y COLA
// ==========================================
async function searchOnlineMusic() {
    const query = document.getElementById('search-input').value;
    if (!query) return;

    const url = `https://api.jamendo.com/v3.0/tracks/?client_id=${JAMENDO_CLIENT_ID}&format=json&limit=10&search=${query}`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        const resultsUl = document.getElementById('online-results');
        resultsUl.innerHTML = '';

        data.results.forEach(track => {
            const li = document.createElement('li');
            li.className = "search-item";
            li.innerHTML = `
                <span class="track-info"><strong>${track.name}</strong> - ${track.artist_name}</span>
                <div class="actions">
                    <button onclick="reproducirInmediato('${track.audio}', '${track.name}')" class="mini-btn text-green"><i class="fas fa-play"></i></button>
                    <button onclick="agregarACola('${track.audio}', '${track.name}')" class="mini-btn"><i class="fas fa-plus"></i></button>
                    <a href="${track.audio}" download="${track.name}.mp3" target="_blank" class="mini-btn download-btn"><i class="fas fa-download"></i></a>
                </div>
            `;
            resultsUl.appendChild(li);
        });
    } catch (err) {
        console.error("Error consultando la API de música:", err);
    }
}

function reproducirInmediato(url, nombre) {
    initAudioEngine();
    audio.src = url;
    document.getElementById('track-title').innerText = nombre;
    audio.play();
    document.getElementById('btn-play').innerHTML = '<i class="fas fa-pause"></i>';
}

function agregarACola(url, nombre) {
    colaDeReproduccion.push({ url, nombre });
    actualizarInterfazCola();
}

function actualizarInterfazCola() {
    const playlistUl = document.getElementById('playlist-queue');
    if (!playlistUl) return;
    playlistUl.innerHTML = '';

    colaDeReproduccion.forEach((cancion, index) => {
        const li = document.createElement('li');
        li.className = `queue-item ${index === indiceActual ? 'active-track' : ''}`;
        li.innerText = `${index + 1}. ${cancion.nombre}`;
        li.onclick = () => {
            indiceActual = index;
            reproducirInmediato(cancion.url, cancion.nombre);
            actualizarInterfazCola();
        };
        playlistUl.appendChild(li);
    });
}

// Al terminar una canción, saltar a la siguiente en la lista automáticamente
audio.addEventListener('ended', () => {
    if (indiceActual + 1 < colaDeReproduccion.length) {
        indiceActual++;
        const siguiente = colaDeReproduccion[indiceActual];
        reproducirInmediato(siguiente.url, siguiente.nombre);
        actualizarInterfazCola();
    }
});

// ==========================================
// 7. EVENTOS DE INTERFAZ (LISTENERS)
// ==========================================
document.getElementById('btn-play').addEventListener('click', () => {
    initAudioEngine();
    if (audio.paused) {
        audio.play();
        document.getElementById('btn-play').innerHTML = '<i class="fas fa-pause"></i>';
    } else {
        audio.pause();
        document.getElementById('btn-play').innerHTML = '<i class="fas fa-play"></i>';
    }
});

document.getElementById('local-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        initAudioEngine();
        document.getElementById('track-title').innerText = file.name.replace(/\.[^/.]+$/, "");
        audio.src = URL.createObjectURL(file);
        audio.play();
        document.getElementById('btn-play').innerHTML = '<i class="fas fa-pause"></i>';
    }
});

document.querySelectorAll('.eq-slider').forEach(slider => {
    slider.addEventListener('input', (e) => {
        initAudioEngine();
        const index = e.target.dataset.filter;
        if (filters[index]) {
            filters[index].gain.value = e.target.value;
        }
    });
});
