// ==========================================
// 1. VARIABLES GLOBALES Y CONFIGURACIÓN
// ==========================================
const audio = document.getElementById('audio-element');
const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');

let JAMENDO_CLIENT_ID = localStorage.getItem('jamendo_key') || '549df9c9'; 
let colaDeReproduccion = [];
let favoritos = JSON.parse(localStorage.getItem('player_favorites')) || [];
let indiceActual = 0;

// Nodos del Sistema Web Audio
let audioCtx, analyser, source, volumeNode;
let filters = [];          // Para el Ecualizador
let pannerNode;           // Para el Panning Estéreo
let filtroDistancia;      // Para el Low Pass Filter espacial

// Nodos del Motor de Reverb/Eco Algorítmico (8D Mejorado)
let reverbGainNode, delayNode, delayFeedback;

// Estado del arrastre (Drag & Drop)
let isDragging = false;
const spatialContainer = document.getElementById('spatial-container');
const soundDot = document.getElementById('sound-dot');

// Cargar UI inicial de llaves guardadas al arrancar
document.addEventListener("DOMContentLoaded", () => {
    ajustarDimensionesCanvas();
    const inputKey = document.getElementById('api-jamendo-key');
    if(inputKey && localStorage.getItem('jamendo_key')) {
        inputKey.value = localStorage.getItem('jamendo_key');
    }
    setupBarrasProgreso();
});

function ajustarDimensionesCanvas() {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
}

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
// 3. MOTOR DE AUDIO CENTRAL (CONEXIONES PRO)
// ==========================================
function initAudioEngine() {
    if (audioCtx) return;

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    source = audioCtx.createMediaElementSource(audio);
    analyser = audioCtx.createAnalyser();
    
    volumeNode = audioCtx.createGain();
    pannerNode = audioCtx.createStereoPanner();
    
    filtroDistancia = audioCtx.createBiquadFilter();
    filtroDistancia.type = 'lowpass';
    filtroDistancia.frequency.value = 20000;

    // --- REVERB ALGORÍTMICO NATIVO (Sin archivos externos) ---
    reverbGainNode = audioCtx.createGain();
    reverbGainNode.gain.value = 0; 
    
    delayNode = audioCtx.createDelay();
    delayNode.delayTime.value = 0.18; // Retraso de simulación de sala
    
    delayFeedback = audioCtx.createGain();
    delayFeedback.gain.value = 0.35; // Nivel de eco interno

    // Bucle del eco
    delayNode.connect(delayFeedback);
    delayFeedback.connect(delayNode);

    // --- CONFIGURACIÓN DEL ECUALIZADOR (5 BANDAS) ---
    const frecuencias = [60, 230, 910, 4000, 14000];
    let lastFilter = source;

    frecuencias.forEach((freq) => {
        let filter = audioCtx.createBiquadFilter();
        filter.type = (freq === 60) ? "lowshelf" : (freq === 14000) ? "highshelf" : "peaking";
        filter.frequency.value = freq;
        filter.Q.value = 1;
        filter.gain.value = 0;

        lastFilter.connect(filter);
        filters.push(filter);
        lastFilter = filter;
    });

    // --- ENCADENAMIENTO DE NODOS ---
    // Cadena Principal: Source -> EQ -> Panner -> Filtro Spat -> Volume (Fade) -> Analyser -> Parlantes
    lastFilter.connect(pannerNode);
    pannerNode.connect(filtroDistancia);
    filtroDistancia.connect(volumeNode);
    volumeNode.connect(analyser);
    analyser.connect(audioCtx.destination);

    // Ruta paralela para Reverb Espacial (Inyecta el eco en base a distancia)
    filtroDistancia.connect(reverbGainNode);
    reverbGainNode.connect(delayNode);
    delayNode.connect(audioCtx.destination);

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

        ctx.fillStyle = '#121212';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const barWidth = (canvas.width / bufferLength) * 1.6;
        let barHeight;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            barHeight = dataArray[i] / 1.4;
            // Suavizado dinámico por hardware de opacidad de color
            ctx.fillStyle = `rgba(29, 185, 84, ${barHeight / 240})`; 
            ctx.fillRect(x, canvas.height - barHeight, barWidth - 2, barHeight);
            x += barWidth;
        }
    }
    draw();
}

// ==========================================
// 5. SISTEMA DE SONIDO ESPACIAL (8D REALISTA)
// ==========================================
function actualizarSonidoEspacial(x, y) {
    if (!audioCtx) return;

    // 1. Efecto Panning Estéreo Estándar
    pannerNode.pan.setValueAtTime(x, audioCtx.currentTime);
    
    // 2. Cálculo matemático de distancia euclidiana al centro (0,0)
    const distancia = Math.sqrt(x * x + y * y); 
    const maxDistancia = Math.sqrt(2); 
    const factorDistancia = Math.min(distancia / maxDistancia, 1); 

    // Al alejarse, sube el volumen del eco/reverb nativo
    reverbGainNode.gain.setValueAtTime(factorDistancia * 0.5, audioCtx.currentTime);

    // Filtro Lowpass Dinámico: Ahoga agudos y los bajos se vuelven pesados y envolventes
    const de20k_a_1k = 20000 - (factorDistancia * 18800);
    filtroDistancia.frequency.setValueAtTime(de20k_a_1k, audioCtx.currentTime);
}

// Gestión del mouse para interactuar en el espacio
if (spatialContainer && soundDot) {
    spatialContainer.addEventListener('mousedown', () => isDragging = true);
    window.addEventListener('mouseup', () => isDragging = false);
    
    spatialContainer.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        initAudioEngine();

        const rect = spatialContainer.getBoundingClientRect();
        let posX = e.clientX - rect.left;
        let posY = e.clientY - rect.top;

        posX = Math.max(0, Math.min(posX, rect.width));
        posY = Math.max(0, Math.min(posY, rect.height));

        soundDot.style.left = `${posX}px`;
        soundDot.style.top = `${posY}px`;

        // Normalizar los valores al plano cartesiano (-1 a 1)
        const normalizedX = ((posX / rect.width) * 2) - 1;
        const normalizedY = -(((posY / rect.height) * 2) - 1); 

        actualizarSonidoEspacial(normalizedX, normalizedY);
    });
}

// ==========================================
// 6. CONTROLADORES PRO (TRANSICIÓN DE SPOTIFY, DEEZER)
// ==========================================
function alternarReproduccionSuave() {
    initAudioEngine();
    const fadeTime = 0.35; // Rampa de 350ms para evitar clicks acústicos

    if (audio.paused) {
        volumeNode.gain.setValueAtTime(0, audioCtx.currentTime);
        audio.play();
        volumeNode.gain.linearRampToValueAtTime(1, audioCtx.currentTime + fadeTime);
        document.getElementById('btn-play').innerHTML = '<i class="fas fa-pause"></i>';
    } else {
        volumeNode.gain.setValueAtTime(1, audioCtx.currentTime);
        volumeNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + fadeTime);
        setTimeout(() => { audio.pause(); }, fadeTime * 1000);
        document.getElementById('btn-play').innerHTML = '<i class="fas fa-play"></i>';
    }
}

// Barra de progreso interactiva
function setupBarrasProgreso() {
    const progressBar = document.getElementById('progress-bar');
    
    audio.addEventListener('timeupdate', () => {
        if (!isNaN(audio.duration)) {
            const pct = (audio.currentTime / audio.duration) * 100;
            progressBar.value = pct;
            document.getElementById('current-time').innerText = formatTime(audio.currentTime);
            document.getElementById('total-duration').innerText = formatTime(audio.duration);
        }
    });

    progressBar.addEventListener('input', (e) => {
        if (!isNaN(audio.duration)) {
            audio.currentTime = (e.target.value / 100) * audio.duration;
        }
    });
}

function formatTime(secs) {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// ==========================================
// 7. GESTIÓN DE APIS, BÚSQUEDA Y PORTADAS
// ==========================================
async function searchOnlineMusic() {
    const query = document.getElementById('search-input').value;
    if (!query) return;

    const url = `https://api.jamendo.com/v3.0/tracks/?client_id=${JAMENDO_CLIENT_ID}&format=json&limit=12&search=${query}`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        const resultsUl = document.getElementById('online-results');
        resultsUl.innerHTML = '';

        if(!data.results || data.results.length === 0) {
            resultsUl.innerHTML = '<li style="padding:20px; color:#666; text-align:center;">Sin resultados. Verifica tu API key.</li>';
            return;
        }

        data.results.forEach(track => {
            const imgUrl = track.album_image || track.image || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=500';
            const isLiked = favoritos.some(f => f.url === track.audio);

            const li = document.createElement('li');
            li.className = "search-item";
            li.setAttribute('data-url', track.audio);
            li.innerHTML = `
                <span class="track-info"><strong>${track.name}</strong> - ${track.artist_name}</span>
                <div class="actions">
                    <button onclick="toggleLike('${track.audio}', '${track.name}')" class="mini-btn btn-heart ${isLiked ? 'liked' : ''}"><i class="fas fa-heart"></i></button>
                    <button onclick="reproducirInmediato('${track.audio}', '${track.name}', '${imgUrl}')" class="mini-btn text-green"><i class="fas fa-play"></i></button>
                    <button onclick="agregarACola('${track.audio}', '${track.name}', '${imgUrl}')" class="mini-btn"><i class="fas fa-plus"></i></button>
                    <a href="${track.audio}" download="${track.name}.mp3" target="_blank" class="mini-btn"><i class="fas fa-download"></i></a>
                </div>
            `;
            resultsUl.appendChild(li);
        });
    } catch (err) {
        console.error("Falla en la API de streaming remota:", err);
    }
}

function reproducirInmediato(url, nombre, portadaUrl) {
    initAudioEngine();
    audio.src = url;
    document.getElementById('track-title').innerText = nombre;
    
    // Cambiar carátula e inyectar el indicador Tidal de calidad
    document.getElementById('cover-art').src = portadaUrl;
    document.getElementById('quality-container').innerHTML = url.includes('blob:') ? 
        '<span class="badge-quality">Hi-Fi Flac</span>' : '<span class="badge-quality">HQ MP3</span>';

    volumeNode.gain.setValueAtTime(0, audioCtx.currentTime);
    audio.play();
    volumeNode.gain.linearRampToValueAtTime(1, audioCtx.currentTime + 0.3);
    document.getElementById('btn-play').innerHTML = '<i class="fas fa-pause"></i>';
}

function agregarACola(url, nombre, portadaUrl) {
    colaDeReproduccion.push({ url, nombre, portadaUrl });
    actualizarInterfazCola();
}

function actualizarInterfazCola() {
    const playlistUl = document.getElementById('playlist-queue');
    playlistUl.innerHTML = '';

    colaDeReproduccion.forEach((cancion, index) => {
        const li = document.createElement('li');
        li.className = `queue-item ${index === indiceActual ? 'active-track' : ''}`;
        li.innerText = `${index + 1}. ${cancion.nombre}`;
        li.onclick = () => {
            indiceActual = index;
            reproducirInmediato(cancion.url, cancion.nombre, cancion.portadaUrl);
            actualizarInterfazCola();
        };
        playlistUl.appendChild(li);
    });
}

// Favoritos estilo SoundCloud
function toggleLike(trackUrl, trackName) {
    const index = favoritos.findIndex(f => f.url === trackUrl);
    const btns = document.querySelectorAll(`[data-url="${trackUrl}"] .btn-heart`);
    
    if (index === -1) {
        favoritos.push({ url: trackUrl, nombre: trackName });
        btns.forEach(b => b.classList.add('liked'));
    } else {
        favoritos.splice(index, 1);
        btns.forEach(b => b.classList.remove('liked'));
    }
    localStorage.setItem('player_favorites', JSON.stringify(favoritos));
}

function guardarAPIKeys() {
    const key = document.getElementById('api-jamendo-key').value.trim();
    localStorage.setItem('jamendo_key', key || '549df9c9');
    JAMENDO_CLIENT_ID = key || '549df9c9';
    alert("API Key procesada y guardada.");
}

// Auto-play continuo de la cola de reproducción
audio.addEventListener('ended', () => {
    if (indiceActual + 1 < colaDeReproduccion.length) {
        indiceActual++;
        const sig = colaDeReproduccion[indiceActual];
        reproducirInmediato(sig.url, sig.nombre, sig.portadaUrl);
        actualizarInterfazCola();
    }
});

// Listener para carga de archivos desde la computadora
document.getElementById('local-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const urlBlob = URL.createObjectURL(file);
        const nameClean = file.name.replace(/\.[^/.]+$/, "");
        const localCover = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?q=80&w=500';
        reproducirInmediato(urlBlob, nameClean, localCover);
    }
});

// Eventos de controles directos
document.getElementById('btn-play').addEventListener('click', alternarReproduccionSuave);

document.querySelectorAll('.eq-slider').forEach(slider => {
    slider.addEventListener('input', (e) => {
        initAudioEngine();
        const idx = e.target.dataset.filter;
        if (filters[idx]) filters[idx].gain.value = e.target.value;
    });
});